# -------------------------------------------------------------------------
# VoiceLive Agent - Azure VoiceLive SDK Integration
# Based on the sample code provided, adapted for phone call integration
# -------------------------------------------------------------------------
from __future__ import annotations
import asyncio
import base64
import logging
import time
from typing import Union, Optional, TYPE_CHECKING
from datetime import datetime
from collections import deque

from azure.core.credentials import AzureKeyCredential
from azure.core.credentials_async import AsyncTokenCredential

from azure.ai.voicelive.aio import connect
from starlette.websockets import WebSocketState
from azure.ai.voicelive.models import (
    AudioEchoCancellation,
    AudioInputTranscriptionOptions,
    AudioNoiseReduction,
    AzureStandardVoice,
    InputAudioFormat,
    Modality,
    OutputAudioFormat,
    RequestSession,
    ServerEventType,
    ServerVad
)

if TYPE_CHECKING:
    from azure.ai.voicelive.aio import VoiceLiveConnection
    from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WarmConnection:
    """A pre-warmed VoiceLive connection ready for immediate use."""
    
    def __init__(self, connection: "VoiceLiveConnection", created_at: float):
        self.connection = connection
        self.created_at = created_at
        self.session_ready = False
        self._context_manager = None
    
    def is_expired(self, max_age_seconds: float = 30.0) -> bool:
        """Check if connection is too old to use."""
        return (time.time() - self.created_at) > max_age_seconds


class ConnectionPool:
    """
    Pool of pre-warmed VoiceLive connections to reduce call start latency.
    
    Maintains a small pool of ready-to-use connections that can be claimed
    by incoming calls, eliminating the connection establishment delay.
    """
    
    def __init__(
        self,
        endpoint: str,
        credential: Union[AzureKeyCredential, AsyncTokenCredential],
        model: str,
        pool_size: int = 2,
        max_connection_age: float = 30.0,
    ):
        self.endpoint = endpoint
        self.credential = credential
        self.model = model
        self.pool_size = pool_size
        self.max_connection_age = max_connection_age
        
        self._pool: deque[WarmConnection] = deque()
        self._lock = asyncio.Lock()
        self._warming_task: Optional[asyncio.Task] = None
        self._running = False
    
    async def start(self):
        """Start the connection pool and begin pre-warming."""
        self._running = True
        self._warming_task = asyncio.create_task(self._maintain_pool())
        logger.info(f"Connection pool started (size={self.pool_size})")
    
    async def stop(self):
        """Stop the connection pool and cleanup."""
        self._running = False
        if self._warming_task:
            self._warming_task.cancel()
            try:
                await self._warming_task
            except asyncio.CancelledError:
                pass
        
        # Close all pooled connections
        async with self._lock:
            while self._pool:
                warm = self._pool.popleft()
                try:
                    await warm.connection.__aexit__(None, None, None)
                except Exception as e:
                    logger.debug(f"Error closing pooled connection: {e}")
        
        logger.info("Connection pool stopped")
    
    async def _create_warm_connection(self) -> Optional[WarmConnection]:
        """Create a new pre-warmed connection."""
        try:
            logger.debug("Creating new warm connection...")
            start = time.time()
            
            # Create connection context manager and enter it
            ctx = connect(
                endpoint=self.endpoint,
                credential=self.credential,
                model=self.model,
            )
            connection = await ctx.__aenter__()
            
            warm = WarmConnection(connection, time.time())
            warm._context_manager = ctx
            
            elapsed = time.time() - start
            logger.info(f"Pre-warmed connection created in {elapsed:.2f}s")
            return warm
            
        except Exception as e:
            logger.error(f"Failed to create warm connection: {e}")
            return None
    
    async def _maintain_pool(self):
        """Background task to maintain pool of warm connections."""
        while self._running:
            try:
                async with self._lock:
                    # Remove expired connections
                    while self._pool and self._pool[0].is_expired(self.max_connection_age):
                        expired = self._pool.popleft()
                        try:
                            if expired._context_manager:
                                await expired._context_manager.__aexit__(None, None, None)
                        except Exception as e:
                            logger.debug(f"Error closing expired connection: {e}")
                        logger.debug("Removed expired warm connection")
                    
                    current_size = len(self._pool)
                
                # Create new connections if pool is below target
                if current_size < self.pool_size:
                    warm = await self._create_warm_connection()
                    if warm:
                        async with self._lock:
                            self._pool.append(warm)
                
                # Check pool every 5 seconds
                await asyncio.sleep(5.0)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in pool maintenance: {e}")
                await asyncio.sleep(1.0)
    
    async def acquire(self) -> Optional[tuple["VoiceLiveConnection", WarmConnection]]:
        """
        Acquire a warm connection from the pool.
        
        Returns tuple of (connection, warm_connection) or None if pool is empty.
        The warm_connection contains the context manager for cleanup.
        """
        async with self._lock:
            # Find a non-expired connection
            while self._pool:
                warm = self._pool.popleft()
                if not warm.is_expired(self.max_connection_age):
                    logger.info("Acquired warm connection from pool")
                    # Trigger refill
                    asyncio.create_task(self._trigger_refill())
                    return (warm.connection, warm)
                else:
                    # Close expired connection
                    try:
                        if warm._context_manager:
                            await warm._context_manager.__aexit__(None, None, None)
                    except Exception:
                        pass
        
        logger.debug("No warm connections available in pool")
        return None
    
    async def _trigger_refill(self):
        """Trigger a pool refill after acquiring a connection."""
        # Small delay to avoid thundering herd
        await asyncio.sleep(0.1)
        warm = await self._create_warm_connection()
        if warm:
            async with self._lock:
                if len(self._pool) < self.pool_size:
                    self._pool.append(warm)
                else:
                    # Pool is full, close this connection
                    try:
                        if warm._context_manager:
                            await warm._context_manager.__aexit__(None, None, None)
                    except Exception:
                        pass
    
    def pool_status(self) -> dict:
        """Get current pool status."""
        return {
            "size": len(self._pool),
            "target_size": self.pool_size,
            "running": self._running,
        }


# Global connection pool instance
_connection_pool: Optional[ConnectionPool] = None


async def init_connection_pool(
    endpoint: str,
    credential: Union[AzureKeyCredential, AsyncTokenCredential],
    model: str,
    pool_size: int = 2,
) -> ConnectionPool:
    """Initialize the global connection pool."""
    global _connection_pool
    if _connection_pool is not None:
        await _connection_pool.stop()
    
    _connection_pool = ConnectionPool(
        endpoint=endpoint,
        credential=credential,
        model=model,
        pool_size=pool_size,
    )
    await _connection_pool.start()
    return _connection_pool


async def shutdown_connection_pool():
    """Shutdown the global connection pool."""
    global _connection_pool
    if _connection_pool:
        await _connection_pool.stop()
        _connection_pool = None


def get_connection_pool() -> Optional[ConnectionPool]:
    """Get the global connection pool instance."""
    return _connection_pool


class VoiceLiveAgent:
    """
    VoiceLive Agent that handles voice conversations using Azure VoiceLive SDK.
    
    Can be used with:
    - Phone calls via ACS (audio bridged through media streaming)
    - Direct WebSocket connections from web clients
    """

    AUDIO_OUTPUT_READY_TIMEOUT_SECONDS = 5.0

    def __init__(
        self,
        endpoint: str,
        credential: Union[AzureKeyCredential, AsyncTokenCredential],
        model: str,
        voice: str,
        instructions: str,
        call_id: str,
        websocket: Optional["WebSocket"] = None,
    ):
        self.endpoint = endpoint
        self.credential = credential
        self.model = model
        self.voice = voice
        self.instructions = instructions
        self.call_id = call_id
        self.websocket = websocket  # Optional: for direct WebSocket clients

        self.connection: Optional["VoiceLiveConnection"] = None
        self.session_ready = False
        self.session_id: Optional[str] = None
        self.websocket_ready = False  # Flag to control when agent can send to websocket
        self._active_response = False
        self._response_api_done = False
        self._running = False
        self._audio_output_callback = None
        self._transcript_callback = None
        self._barge_in_callback = None  # Callback to trigger StopAudio on phone
        self._warm_connection: Optional[WarmConnection] = None
        self._user_speaking = False  # Flag to suppress audio output during barge-in
        self._audio_output_ready_event = asyncio.Event()

    def set_audio_output_callback(self, callback):
        """Set callback for audio output from the agent."""
        self._audio_output_callback = callback
        self._audio_output_ready_event.set()

    def set_transcript_callback(self, callback):
        """Set callback for transcripts."""
        self._transcript_callback = callback

    def set_barge_in_callback(self, callback):
        """Set callback for barge-in events (to stop audio on phone)."""
        self._barge_in_callback = callback

    async def start(self):
        """Start the VoiceLive agent session."""
        self._running = True
        start_time = time.time()

        try:
            # Try to get a pre-warmed connection from the pool first
            pool = get_connection_pool()
            warm_result = None
            if pool:
                warm_result = await pool.acquire()
            
            if warm_result:
                # Use pre-warmed connection
                connection, self._warm_connection = warm_result
                self.connection = connection
                elapsed = time.time() - start_time
                logger.info(f"[{self.call_id}] Using pre-warmed connection (acquired in {elapsed:.3f}s)")
                
                try:
                    # Configure session
                    await self._setup_session()
                    logger.info(f"[{self.call_id}] VoiceLive agent ready")
                    
                    # Process events
                    logger.info(f"[{self.call_id}] Starting event processing loop")
                    await self._process_events()
                    logger.info(f"[{self.call_id}] Event processing loop ended normally")
                except Exception as e:
                    logger.exception(f"[{self.call_id}] Error in event processing: {e}")
                    raise
                finally:
                    # Clean up the warm connection
                    if self._warm_connection and self._warm_connection._context_manager:
                        try:
                            await self._warm_connection._context_manager.__aexit__(None, None, None)
                        except Exception as e:
                            logger.debug(f"[{self.call_id}] Error closing warm connection: {e}")
            else:
                # Fall back to creating new connection
                logger.info(f"[{self.call_id}] Connecting to VoiceLive API with model {self.model}")

                async with connect(
                    endpoint=self.endpoint,
                    credential=self.credential,
                    model=self.model,
                ) as connection:
                    self.connection = connection
                    elapsed = time.time() - start_time
                    logger.info(f"[{self.call_id}] Connection established in {elapsed:.2f}s")

                    # Configure session
                    await self._setup_session()

                    logger.info(f"[{self.call_id}] VoiceLive agent ready")
                    
                    # Process events
                    logger.info(f"[{self.call_id}] Starting event processing loop")
                    await self._process_events()
                    logger.info(f"[{self.call_id}] Event processing loop ended normally")

        except asyncio.CancelledError:
            logger.info(f"[{self.call_id}] Agent cancelled")
            raise
        except Exception as e:
            logger.exception(f"[{self.call_id}] Agent error: {e}")
            raise
        finally:
            logger.info(f"[{self.call_id}] Agent start() finally block, setting running=False")
            self._running = False
            self.connection = None
            self._warm_connection = None

    async def stop(self):
        """Stop the VoiceLive agent."""
        self._running = False
        logger.info(f"[{self.call_id}] Stopping agent")

    async def send_audio(self, audio_base64: str):
        """Send audio data to VoiceLive (from phone call or microphone)."""
        if self.connection and self.session_ready:
            try:
                await self.connection.input_audio_buffer.append(audio=audio_base64)
            except Exception as e:
                logger.error(f"[{self.call_id}] Failed to send audio: {e}")

    async def send_audio_bytes(self, audio_bytes: bytes):
        """Send raw audio bytes to VoiceLive."""
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
        await self.send_audio(audio_base64)

    async def _setup_session(self):
        """Configure the VoiceLive session for audio conversation."""
        logger.info(f"[{self.call_id}] Setting up voice conversation session...")

        # Create voice configuration
        voice_config: Union[AzureStandardVoice, str]
        if "-" in self.voice and any(
            self.voice.startswith(prefix) for prefix in ["en-US-", "en-CA-", "en-GB-", "es-", "fr-", "de-", "ja-", "zh-"]
        ):
            # Azure TTS voice
            voice_config = AzureStandardVoice(name=self.voice)
        else:
            # OpenAI voice (alloy, echo, fable, onyx, nova, shimmer)
            voice_config = self.voice

        # Create turn detection configuration for phone calls
        # Lower threshold and shorter padding for faster barge-in/interruption detection
        turn_detection_config = ServerVad(
            threshold=0.3,  # Lower threshold for phone audio (was 0.5)
            prefix_padding_ms=100,  # Faster speech detection (was 200)
            silence_duration_ms=400,  # Faster turn-taking (was 500)
        )

        # Create session configuration with input transcription enabled
        session_config = RequestSession(
            modalities=[Modality.TEXT, Modality.AUDIO],
            instructions=self.instructions,
            voice=voice_config,
            input_audio_format=InputAudioFormat.PCM16,
            output_audio_format=OutputAudioFormat.PCM16,
            turn_detection=turn_detection_config,
            input_audio_echo_cancellation=AudioEchoCancellation(),
            input_audio_noise_reduction=AudioNoiseReduction(type="azure_deep_noise_suppression"),
            input_audio_transcription=AudioInputTranscriptionOptions(
                model="whisper-1",  # Enable user speech transcription
            ),
        )

        assert self.connection is not None
        await self.connection.session.update(session=session_config)
        logger.info(f"[{self.call_id}] Session configuration sent")

    async def _process_events(self):
        """Process events from the VoiceLive connection."""
        try:
            assert self.connection is not None
            async for event in self.connection:
                if not self._running:
                    break
                await self._handle_event(event)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(f"[{self.call_id}] Error processing events")
            raise

    async def _handle_event(self, event):
        """Handle different types of events from VoiceLive."""
        logger.debug(f"[{self.call_id}] Received event: {event.type}")

        if event.type == ServerEventType.SESSION_UPDATED:
            logger.info(f"[{self.call_id}] Session ready: {event.session.id}")
            self.session_id = event.session.id
            self.session_ready = True
            
            # Trigger initial greeting - tell the model to start the conversation
            await self._trigger_initial_greeting()

        elif event.type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED:
            logger.info(f"[{self.call_id}] User started speaking (barge-in)")
            
            # Immediately stop sending audio to allow user to interrupt
            self._user_speaking = True
            
            # Trigger barge-in callback to send StopAudio to phone
            # This clears any buffered audio on the ACS side
            if self._barge_in_callback:
                try:
                    await self._barge_in_callback()
                except Exception as e:
                    logger.warning(f"[{self.call_id}] Barge-in callback failed: {e}")

            # Cancel any in-progress response (barge-in)
            if self._active_response and not self._response_api_done:
                try:
                    await self.connection.response.cancel()
                    logger.debug(f"[{self.call_id}] Cancelled in-progress response")
                except Exception as e:
                    if "no active response" not in str(e).lower():
                        logger.warning(f"[{self.call_id}] Cancel failed: {e}")

            if self.websocket:
                await self._send_to_websocket({"type": "speech_started"})

        elif event.type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STOPPED:
            logger.info(f"[{self.call_id}] User stopped speaking")
            
            # Resume audio output now that user finished speaking
            self._user_speaking = False

            if self.websocket:
                await self._send_to_websocket({"type": "speech_stopped"})

        elif event.type == ServerEventType.RESPONSE_CREATED:
            logger.info(f"[{self.call_id}] Assistant response created")
            self._active_response = True
            self._response_api_done = False

        elif event.type == ServerEventType.RESPONSE_AUDIO_DELTA:
            # Audio from the AI assistant - send to phone call or websocket
            # Skip audio output if user is speaking (barge-in) to reduce latency
            if self._user_speaking:
                logger.debug(f"[{self.call_id}] Skipping audio delta - user is speaking (barge-in)")
                return
                
            if event.delta:
                logger.debug(f"[{self.call_id}] Audio delta received: {len(event.delta)} bytes, callback set: {self._audio_output_callback is not None}")
                if self._audio_output_callback:
                    await self._audio_output_callback(event.delta)

                if self.websocket:
                    await self._send_to_websocket({
                        "type": "audio",
                        "data": base64.b64encode(event.delta).decode("utf-8"),
                    })

        elif event.type == ServerEventType.RESPONSE_AUDIO_DONE:
            logger.info(f"[{self.call_id}] Assistant finished speaking")

        elif event.type == ServerEventType.RESPONSE_DONE:
            logger.info(f"[{self.call_id}] Response complete")
            self._active_response = False
            self._response_api_done = True

        elif event.type == ServerEventType.RESPONSE_AUDIO_TRANSCRIPT_DELTA:
            # Partial transcript of AI response (for real-time streaming to websocket)
            if hasattr(event, 'delta') and event.delta:
                if self.websocket:
                    await self._send_to_websocket({
                        "type": "transcript",
                        "role": "assistant",
                        "delta": event.delta,
                    })

        elif event.type == ServerEventType.RESPONSE_AUDIO_TRANSCRIPT_DONE:
            # Complete transcript of AI response
            transcript = getattr(event, 'transcript', '')
            if transcript:
                logger.info(f"[{self.call_id}] Assistant said: {transcript}")
                
                if self._transcript_callback:
                    await self._transcript_callback("assistant", transcript, partial=False)

                if self.websocket:
                    await self._send_to_websocket({
                        "type": "transcript",
                        "role": "assistant",
                        "text": transcript,
                    })

        elif event.type == ServerEventType.CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_COMPLETED:
            # User's speech transcription
            transcript = getattr(event, 'transcript', '')
            if transcript:
                logger.info(f"[{self.call_id}] User said: {transcript}")

                if self._transcript_callback:
                    await self._transcript_callback("user", transcript, partial=False)

                if self.websocket:
                    await self._send_to_websocket({
                        "type": "transcript",
                        "role": "user",
                        "text": transcript,
                    })

        elif event.type == ServerEventType.ERROR:
            msg = event.error.message if hasattr(event, 'error') else str(event)
            if "no active response" not in msg.lower():
                logger.error(f"[{self.call_id}] VoiceLive error: {msg}")

                if self.websocket:
                    await self._send_to_websocket({
                        "type": "error",
                        "message": msg,
                    })

        elif event.type == ServerEventType.CONVERSATION_ITEM_CREATED:
            logger.debug(f"[{self.call_id}] Conversation item created")

        else:
            logger.debug(f"[{self.call_id}] Unhandled event type: {event.type}")

    async def _send_to_websocket(self, data: dict):
        """Send data to connected WebSocket client."""
        if self.websocket and self.websocket_ready:
            try:
                if self.websocket.client_state != WebSocketState.CONNECTED:
                    return
                await self.websocket.send_json(data)
            except Exception as e:
                logger.error(f"[{self.call_id}] Failed to send to websocket: {e}")

    async def _wait_for_output_ready(self) -> None:
        """Wait for an output channel to be ready before triggering initial greeting."""
        timeout_seconds = self.AUDIO_OUTPUT_READY_TIMEOUT_SECONDS

        # Only wait for websocket clients (not phone calls)
        # Phone calls rely on the delay in main.py before agent.start()
        if self.websocket:
            start_time = time.time()
            while not self.websocket_ready:
                if time.time() - start_time > timeout_seconds:
                    logger.warning(f"[{self.call_id}] WebSocket not ready after {timeout_seconds}s; proceeding")
                    return
                await asyncio.sleep(0.05)

    async def _trigger_initial_greeting(self):
        """Trigger the AI to start the conversation with a greeting."""
        if not self.connection:
            return
        
        try:
            await self._wait_for_output_ready()
            logger.info(f"[{self.call_id}] Triggering initial greeting")
            # Create a response to prompt the AI to speak first
            await self.connection.response.create()
            logger.info(f"[{self.call_id}] Initial greeting triggered")
        except Exception as e:
            logger.error(f"[{self.call_id}] Failed to trigger initial greeting: {e}")
