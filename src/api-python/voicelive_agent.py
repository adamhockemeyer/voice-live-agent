# -------------------------------------------------------------------------
# VoiceLive Agent - Azure VoiceLive SDK Integration
# Based on the sample code provided, adapted for phone call integration
# -------------------------------------------------------------------------
from __future__ import annotations
import asyncio
import base64
import logging
from typing import Union, Optional, TYPE_CHECKING
from datetime import datetime

from azure.core.credentials import AzureKeyCredential
from azure.core.credentials_async import AsyncTokenCredential

from azure.ai.voicelive.aio import connect
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


class VoiceLiveAgent:
    """
    VoiceLive Agent that handles voice conversations using Azure VoiceLive SDK.
    
    Can be used with:
    - Phone calls via ACS (audio bridged through media streaming)
    - Direct WebSocket connections from web clients
    """

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
        self._active_response = False
        self._response_api_done = False
        self._running = False
        self._audio_output_callback = None
        self._transcript_callback = None

    def set_audio_output_callback(self, callback):
        """Set callback for audio output from the agent."""
        self._audio_output_callback = callback

    def set_transcript_callback(self, callback):
        """Set callback for transcripts."""
        self._transcript_callback = callback

    async def start(self):
        """Start the VoiceLive agent session."""
        self._running = True

        try:
            logger.info(f"[{self.call_id}] Connecting to VoiceLive API with model {self.model}")

            async with connect(
                endpoint=self.endpoint,
                credential=self.credential,
                model=self.model,
            ) as connection:
                self.connection = connection

                # Configure session
                await self._setup_session()

                logger.info(f"[{self.call_id}] VoiceLive agent ready")

                # Process events
                await self._process_events()

        except asyncio.CancelledError:
            logger.info(f"[{self.call_id}] Agent cancelled")
        except Exception as e:
            logger.exception(f"[{self.call_id}] Agent error: {e}")
        finally:
            self._running = False
            self.connection = None

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
        turn_detection_config = ServerVad(
            threshold=0.5,
            prefix_padding_ms=200,  # Reduced for faster response
            silence_duration_ms=500,  # Balance between responsiveness and phone latency
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
            self.session_ready = True

            # Notify websocket client if connected
            if self.websocket:
                await self._send_to_websocket({
                    "type": "session_ready",
                    "session_id": event.session.id,
                })

        elif event.type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED:
            logger.info(f"[{self.call_id}] User started speaking")

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

            if self.websocket:
                await self._send_to_websocket({"type": "speech_stopped"})

        elif event.type == ServerEventType.RESPONSE_CREATED:
            logger.info(f"[{self.call_id}] Assistant response created")
            self._active_response = True
            self._response_api_done = False

        elif event.type == ServerEventType.RESPONSE_AUDIO_DELTA:
            # Audio from the AI assistant - send to phone call or websocket
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
        if self.websocket:
            try:
                await self.websocket.send_json(data)
            except Exception as e:
                logger.error(f"[{self.call_id}] Failed to send to websocket: {e}")
