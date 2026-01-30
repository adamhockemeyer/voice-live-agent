# -------------------------------------------------------------------------
# Voice Live Agent - Phone Call Integration
# Integrates Azure VoiceLive SDK with ACS Call Automation for real phone calls
# -------------------------------------------------------------------------
from __future__ import annotations
import os
import asyncio
import base64
import logging
from datetime import datetime
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager

from azure.identity.aio import DefaultAzureCredential
from azure.communication.callautomation.aio import CallAutomationClient
from azure.communication.callautomation import (
    PhoneNumberIdentifier,
    CallInvite,
    MediaStreamingOptions,
    StreamingTransportType,
    MediaStreamingContentType,
    MediaStreamingAudioChannelType,
    AudioFormat,
)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import uvicorn
import json

from voicelive_agent import VoiceLiveAgent, init_connection_pool, shutdown_connection_pool

# Load environment variables
load_dotenv()

# Configure logging
if not os.path.exists('logs'):
    os.makedirs('logs')

timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
logging.basicConfig(
    level=logging.DEBUG,  # Changed to DEBUG to see audio events
    format='%(asctime)s:%(name)s:%(levelname)s:%(message)s',
    handlers=[
        logging.FileHandler(f'logs/{timestamp}_server.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


# Configuration
class Config:
    VOICELIVE_ENDPOINT = os.getenv("AZURE_VOICELIVE_ENDPOINT", "")
    VOICELIVE_MODEL = os.getenv("AZURE_VOICELIVE_MODEL", "gpt-realtime")
    VOICELIVE_VOICE = os.getenv("AZURE_VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural")
    VOICELIVE_INSTRUCTIONS = os.getenv(
        "AZURE_VOICELIVE_INSTRUCTIONS",
        "You are Ava, an AI voice assistant. Be concise, friendly, and professional."
    )
    ACS_ENDPOINT = os.getenv("AZURE_COMMUNICATION_ENDPOINT", "")
    ACS_PHONE_NUMBER = os.getenv("ACS_PHONE_NUMBER", "")
    CALLBACK_URI = os.getenv("CALLBACK_URI", "http://localhost:8000")
    PORT = int(os.getenv("PORT", "8000"))


# Active calls storage
active_calls: Dict[str, Dict[str, Any]] = {}
active_agents: Dict[str, VoiceLiveAgent] = {}
active_media_websockets: Dict[str, WebSocket] = {}  # Store media websockets for sending audio back
call_transcripts: Dict[str, list] = {}  # Store transcripts per call
transcript_subscribers: Dict[str, list] = {}  # SSE subscribers per call

# Current inbound agent instructions (can be updated via API)
inbound_agent_instructions: str = Config.VOICELIVE_INSTRUCTIONS


# Request/Response Models
class OutboundCallRequest(BaseModel):
    target_phone_number: str
    source_phone_number: Optional[str] = None
    agenda: Optional[str] = None


class InboundAgentRequest(BaseModel):
    instructions: str


class CallResponse(BaseModel):
    success: bool
    call_id: Optional[str] = None
    message: Optional[str] = None


# Lifespan for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Voice Live Agent Server")
    logger.info(f"VoiceLive Endpoint: {Config.VOICELIVE_ENDPOINT}")
    logger.info(f"ACS Endpoint: {Config.ACS_ENDPOINT}")
    
    # Initialize connection pool for pre-warming VoiceLive connections
    if Config.VOICELIVE_ENDPOINT:
        try:
            credential = DefaultAzureCredential()
            await init_connection_pool(
                endpoint=Config.VOICELIVE_ENDPOINT,
                credential=credential,
                model=Config.VOICELIVE_MODEL,
                pool_size=2,  # Pre-warm 2 connections
            )
            logger.info("Connection pool initialized for pre-warming")
        except Exception as e:
            logger.warning(f"Failed to initialize connection pool: {e}")
    
    yield
    
    # Cleanup on shutdown
    logger.info("Shutting down - cleaning up active calls")
    for call_id, agent in list(active_agents.items()):
        try:
            await agent.stop()
        except Exception as e:
            logger.error(f"Error stopping agent {call_id}: {e}")
    
    # Shutdown connection pool
    await shutdown_connection_pool()
    logger.info("Connection pool shutdown complete")


# FastAPI App
app = FastAPI(
    title="Voice Live Agent API",
    description="Azure VoiceLive SDK integrated with ACS Call Automation",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    from voicelive_agent import get_connection_pool
    pool = get_connection_pool()
    pool_status = pool.pool_status() if pool else {"status": "not_initialized"}
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "connection_pool": pool_status,
    }


@app.get("/api/config")
async def get_config():
    """Get public configuration info (e.g., inbound phone number)."""
    return {
        "inbound_phone_number": Config.ACS_PHONE_NUMBER or None,
        "acs_configured": bool(Config.ACS_ENDPOINT),
        "voicelive_configured": bool(Config.VOICELIVE_ENDPOINT),
    }


@app.get("/api/inbound-agent")
async def get_inbound_agent():
    """Get current inbound agent instructions."""
    return {"instructions": inbound_agent_instructions}


@app.post("/api/inbound-agent")
async def set_inbound_agent(request: InboundAgentRequest):
    """Set instructions for inbound calls."""
    global inbound_agent_instructions
    inbound_agent_instructions = request.instructions
    logger.info(f"Updated inbound agent instructions: {request.instructions[:100]}...")
    return {"success": True, "instructions": inbound_agent_instructions}


@app.get("/api/calls")
async def get_active_calls():
    """List all active calls."""
    return {
        "calls": [
            {
                "call_id": call_id,
                "status": info.get("status"),
                "direction": info.get("direction"),
                "phone_number": info.get("phone_number"),
                "start_time": info.get("start_time"),
            }
            for call_id, info in active_calls.items()
        ]
    }


@app.post("/api/calls/outbound", response_model=CallResponse)
async def make_outbound_call(request: OutboundCallRequest):
    """
    Make an outbound phone call and connect it to VoiceLive agent.
    """
    if not Config.ACS_ENDPOINT:
        raise HTTPException(status_code=500, detail="ACS not configured")

    try:
        credential = DefaultAzureCredential()
        call_client = CallAutomationClient(Config.ACS_ENDPOINT, credential)

        # Use provided source or default
        source_number = request.source_phone_number or Config.ACS_PHONE_NUMBER
        if not source_number:
            raise HTTPException(status_code=400, detail="No source phone number configured")

        target = PhoneNumberIdentifier(request.target_phone_number)
        caller_id = PhoneNumberIdentifier(source_number)

        call_invite = CallInvite(target=target, source_caller_id_number=caller_id)

        # Configure bidirectional media streaming for two-way audio
        media_streaming = MediaStreamingOptions(
            transport_url=f"{Config.CALLBACK_URI.replace('https://', 'wss://').replace('http://', 'ws://')}/ws/media",
            transport_type=StreamingTransportType.WEBSOCKET,
            content_type=MediaStreamingContentType.AUDIO,
            audio_channel_type=MediaStreamingAudioChannelType.MIXED,
            start_media_streaming=False,  # We'll start it after call connects
            enable_bidirectional=True,  # Enable sending audio back to phone
            audio_format=AudioFormat.PCM24_K_MONO,  # 24kHz PCM16 mono (matches VoiceLive)
        )

        # Create the call
        result = await call_client.create_call(
            call_invite,
            callback_url=f"{Config.CALLBACK_URI}/api/calls/events",
            media_streaming=media_streaming,
        )

        # result is CallConnectionProperties directly
        call_connection_id = result.call_connection_id
        call_id = call_connection_id

        # Store call info (including agenda for when the agent starts)
        active_calls[call_id] = {
            "call_connection_id": call_connection_id,
            "status": "connecting",
            "direction": "outbound",
            "phone_number": request.target_phone_number,
            "start_time": datetime.now().isoformat(),
            "agenda": request.agenda,
        }

        logger.info(f"Outbound call initiated: {call_id} to {request.target_phone_number}")

        return CallResponse(success=True, call_id=call_id)

    except Exception as e:
        logger.exception("Failed to make outbound call")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/calls/inbound")
async def handle_inbound_call(request: Request):
    """
    Handle incoming call notification from ACS Event Grid.
    """
    try:
        body = await request.json()
        logger.info(f"Inbound call event: {body}")

        # Handle Event Grid validation
        if isinstance(body, list) and len(body) > 0:
            event = body[0]
            if event.get("eventType") == "Microsoft.EventGrid.SubscriptionValidationEvent":
                validation_code = event["data"]["validationCode"]
                return JSONResponse({"validationResponse": validation_code})

        # Handle incoming call
        incoming_call_context = body.get("incomingCallContext")
        if not incoming_call_context:
            raise HTTPException(status_code=400, detail="Missing incomingCallContext")

        credential = DefaultAzureCredential()
        call_client = CallAutomationClient(Config.ACS_ENDPOINT, credential)

        # Configure bidirectional media streaming for two-way audio
        media_streaming = MediaStreamingOptions(
            transport_url=f"{Config.CALLBACK_URI.replace('https://', 'wss://').replace('http://', 'ws://')}/ws/media",
            transport_type=StreamingTransportType.WEBSOCKET,
            content_type=MediaStreamingContentType.AUDIO,
            audio_channel_type=MediaStreamingAudioChannelType.MIXED,
            enable_bidirectional=True,  # Enable sending audio back to phone
            audio_format=AudioFormat.PCM24_K_MONO,  # 24kHz PCM16 mono (matches VoiceLive)
        )

        # Answer the call
        result = await call_client.answer_call(
            incoming_call_context=incoming_call_context,
            callback_url=f"{Config.CALLBACK_URI}/api/calls/events",
            media_streaming=media_streaming,
        )

        # result is CallConnectionProperties directly
        call_connection_id = result.call_connection_id
        call_id = call_connection_id

        active_calls[call_id] = {
            "call_connection_id": call_connection_id,
            "status": "connected",
            "direction": "inbound",
            "phone_number": body.get("from", {}).get("phoneNumber", {}).get("value", "unknown"),
            "start_time": datetime.now().isoformat(),
        }

        logger.info(f"Answered inbound call: {call_id}")

        return CallResponse(success=True, call_id=call_id)

    except Exception as e:
        logger.exception("Failed to handle inbound call")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/calls/events")
async def handle_call_events(request: Request):
    """
    Handle ACS Call Automation webhook events.
    """
    try:
        events = await request.json()
        if not isinstance(events, list):
            events = [events]

        for event in events:
            event_type = event.get("type", "")
            call_connection_id = event.get("data", {}).get("callConnectionId", "")

            logger.info(f"Call event: {event_type} for {call_connection_id}")

            if event_type == "Microsoft.Communication.CallConnected":
                if call_connection_id in active_calls:
                    active_calls[call_connection_id]["status"] = "connected"
                    logger.info(f"Call connected: {call_connection_id}")
                    
                    # Start media streaming
                    try:
                        credential = DefaultAzureCredential()
                        call_client = CallAutomationClient(Config.ACS_ENDPOINT, credential)
                        call_connection = call_client.get_call_connection(call_connection_id)
                        await call_connection.start_media_streaming()
                        logger.info(f"Started media streaming for {call_connection_id}")
                    except Exception as e:
                        logger.exception(f"Failed to start media streaming: {e}")
                    
                    # Start VoiceLive agent for this call
                    await start_voicelive_agent(call_connection_id)

            elif event_type == "Microsoft.Communication.CallDisconnected":
                if call_connection_id in active_calls:
                    active_calls[call_connection_id]["status"] = "disconnected"
                    # Stop VoiceLive agent
                    await stop_voicelive_agent(call_connection_id)
                    del active_calls[call_connection_id]

            elif event_type == "Microsoft.Communication.PlayCompleted":
                logger.info(f"Play completed for {call_connection_id}")

            elif event_type == "Microsoft.Communication.PlayFailed":
                logger.error(f"Play failed for {call_connection_id}: {event}")

        return {"status": "ok"}

    except Exception as e:
        logger.exception("Failed to handle call event")
        return {"status": "error", "message": str(e)}


@app.post("/api/calls/{call_id}/hangup")
async def hangup_call(call_id: str):
    """Hang up an active call."""
    if call_id not in active_calls:
        raise HTTPException(status_code=404, detail="Call not found")

    try:
        credential = DefaultAzureCredential()
        call_client = CallAutomationClient(Config.ACS_ENDPOINT, credential)

        call_connection = call_client.get_call_connection(call_id)
        await call_connection.hang_up(is_for_everyone=True)

        await stop_voicelive_agent(call_id)

        if call_id in active_calls:
            del active_calls[call_id]

        logger.info(f"Hung up call: {call_id}")
        return CallResponse(success=True, call_id=call_id, message="Call ended")

    except Exception as e:
        logger.exception(f"Failed to hang up call {call_id}")
        raise HTTPException(status_code=500, detail=str(e))


async def broadcast_transcript(call_id: str, role: str, text: str, partial: bool = False):
    """Broadcast transcript to all SSE subscribers for a call."""
    if call_id not in call_transcripts:
        call_transcripts[call_id] = []
    
    transcript_entry = {
        "role": role,
        "text": text,
        "partial": partial,
        "timestamp": datetime.now().isoformat(),
    }
    if not partial:
        call_transcripts[call_id].append(transcript_entry)
    
    # Broadcast to all subscribers
    subscribers = transcript_subscribers.get(call_id, [])
    dead_subscribers = []
    for queue in subscribers:
        try:
            await queue.put(transcript_entry)
        except Exception:
            dead_subscribers.append(queue)
    
    # Clean up dead subscribers
    for queue in dead_subscribers:
        if queue in transcript_subscribers.get(call_id, []):
            transcript_subscribers[call_id].remove(queue)


@app.get("/api/calls/{call_id}/transcripts")
async def get_transcripts(call_id: str):
    """Get all transcripts for a call."""
    return {"transcripts": call_transcripts.get(call_id, [])}


@app.get("/api/calls/{call_id}/transcripts/stream")
async def stream_transcripts(call_id: str):
    """SSE endpoint for real-time transcripts."""
    
    async def event_generator():
        queue = asyncio.Queue()
        
        if call_id not in transcript_subscribers:
            transcript_subscribers[call_id] = []
        transcript_subscribers[call_id].append(queue)
        
        try:
            # Send existing transcripts first
            for transcript in call_transcripts.get(call_id, []):
                yield f"data: {json.dumps(transcript)}\n\n"
            
            # Stream new transcripts
            while True:
                try:
                    transcript = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(transcript)}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive
                    yield f": keepalive\n\n"
                    
                    # Check if call still exists
                    if call_id not in active_calls:
                        yield f"data: {json.dumps({'type': 'call_ended'})}\n\n"
                        break
        finally:
            if call_id in transcript_subscribers and queue in transcript_subscribers[call_id]:
                transcript_subscribers[call_id].remove(queue)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


async def start_voicelive_agent(call_id: str):
    """Start a VoiceLive agent for a call."""
    if call_id in active_agents:
        logger.warning(f"Agent already exists for call {call_id}")
        return

    try:
        # Get agenda from stored call info
        call_info = active_calls.get(call_id, {})
        direction = call_info.get("direction", "inbound")
        
        # For outbound calls, use the agenda from the call request
        # For inbound calls, use the current inbound_agent_instructions
        if direction == "outbound":
            agenda = call_info.get("agenda") or Config.VOICELIVE_INSTRUCTIONS
        else:
            agenda = inbound_agent_instructions
        
        logger.info(f"Using agenda for {direction} call {call_id}: {agenda[:100]}...")

        # Initialize transcript storage for this call
        call_transcripts[call_id] = []

        credential = DefaultAzureCredential()
        agent = VoiceLiveAgent(
            endpoint=Config.VOICELIVE_ENDPOINT,
            credential=credential,
            model=Config.VOICELIVE_MODEL,
            voice=Config.VOICELIVE_VOICE,
            instructions=agenda,
            call_id=call_id,
        )
        active_agents[call_id] = agent

        # Set up transcript callback for SSE streaming
        current_call_id = call_id
        async def transcript_callback(role: str, text: str, partial: bool = False):
            await broadcast_transcript(current_call_id, role, text, partial)
        agent.set_transcript_callback(transcript_callback)

        # Start agent in background
        asyncio.create_task(agent.start())
        logger.info(f"Started VoiceLive agent for call {call_id}")

    except Exception as e:
        logger.exception(f"Failed to start VoiceLive agent for {call_id}")


async def stop_voicelive_agent(call_id: str):
    """Stop a VoiceLive agent for a call."""
    if call_id not in active_agents:
        return

    try:
        agent = active_agents[call_id]
        await agent.stop()
        del active_agents[call_id]
        
        # Clean up transcript subscribers (keep transcripts for retrieval)
        if call_id in transcript_subscribers:
            del transcript_subscribers[call_id]
        
        logger.info(f"Stopped VoiceLive agent for call {call_id}")

    except Exception as e:
        logger.exception(f"Failed to stop VoiceLive agent for {call_id}")


@app.websocket("/ws/media/{call_id}")
async def media_websocket_with_id(websocket: WebSocket, call_id: str):
    """WebSocket endpoint for ACS media streaming with call_id in path."""
    await handle_media_websocket(websocket, call_id)


@app.websocket("/ws/media")
async def media_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for ACS media streaming.
    ACS connects here and sends call info in the messages.
    """
    await websocket.accept()
    logger.info("Media WebSocket connected (waiting for metadata)")
    
    call_id = None
    agent = None
    
    try:
        async for message in websocket.iter_json():
            kind = message.get("kind")
            
            # First message should be metadata with call info
            if kind == "AudioMetadata":
                # Log full message to debug structure
                logger.info(f"AudioMetadata message: {message}")
                
                # ACS doesn't send callConnectionId in metadata - we need to match by timing
                # Since we only have one active call typically, use the most recent one
                metadata = message.get("audioMetadata", {})
                subscription_id = metadata.get("subscriptionId")
                
                # Find the active call (there should be one that just started)
                if active_calls:
                    # Get the most recently added call
                    call_id = list(active_calls.keys())[-1] if active_calls else None
                    logger.info(f"Using active call_id: {call_id}, subscription: {subscription_id}")
                
                if call_id:
                    # Store websocket for sending audio back
                    active_media_websockets[call_id] = websocket
                    
                    # Wait a moment for agent to be ready
                    for _ in range(10):
                        agent = active_agents.get(call_id)
                        if agent:
                            break
                        await asyncio.sleep(0.5)
                    
                    if agent:
                        logger.info(f"Agent found for call {call_id}, setting up audio callback")
                        # Set callback to send audio back to phone
                        # Capture call_id in closure properly
                        current_call_id = call_id
                        async def audio_callback(audio_data: bytes):
                            await send_audio_to_phone(current_call_id, audio_data)
                        agent.set_audio_output_callback(audio_callback)
                    else:
                        logger.warning(f"No agent found for call {call_id}")
            
            elif kind == "AudioData" and agent:
                # Audio from the phone call - send to VoiceLive
                audio_data = message.get("audioData", {}).get("data")
                if audio_data and agent.connection:
                    await agent.send_audio(audio_data)
                    
    except WebSocketDisconnect:
        logger.info(f"Media WebSocket disconnected for call {call_id}")
    except Exception as e:
        logger.exception(f"Error in media WebSocket: {e}")
    finally:
        if call_id and call_id in active_media_websockets:
            del active_media_websockets[call_id]
        # Don't close websocket if already closed
        try:
            await websocket.close()
        except Exception:
            pass


async def send_audio_to_phone(call_id: str, audio_data: bytes):
    """Send audio data back to the phone via the media WebSocket."""
    websocket = active_media_websockets.get(call_id)
    if websocket:
        try:
            # ACS expects audio in a specific format
            audio_b64 = base64.b64encode(audio_data).decode("utf-8")
            await websocket.send_json({
                "kind": "AudioData",
                "audioData": {
                    "data": audio_b64,
                    "timestamp": datetime.now().isoformat(),
                    "silent": False
                }
            })
            logger.debug(f"Sent {len(audio_data)} bytes audio to phone {call_id}")
        except Exception as e:
            logger.error(f"Failed to send audio to phone {call_id}: {e}")
    else:
        logger.warning(f"No websocket found for call {call_id} to send audio")


async def handle_media_websocket(websocket: WebSocket, call_id: str):
    """
    Handle media WebSocket for a specific call.
    Bridges phone call audio to/from VoiceLive agent.
    """
    await websocket.accept()
    logger.info(f"Media WebSocket connected for call {call_id}")

    try:
        agent = active_agents.get(call_id)
        if not agent:
            logger.error(f"No agent found for call {call_id}")
            await websocket.close()
            return

        # Process incoming audio from phone call
        async for message in websocket.iter_json():
            kind = message.get("kind")

            if kind == "AudioData":
                # Audio from the phone call - send to VoiceLive
                audio_data = message.get("audioData", {}).get("data")
                if audio_data and agent.connection:
                    await agent.send_audio(audio_data)

            elif kind == "AudioMetadata":
                logger.info(f"Audio metadata for {call_id}: {message}")

    except WebSocketDisconnect:
        logger.info(f"Media WebSocket disconnected for call {call_id}")
    except Exception as e:
        logger.exception(f"Error in media WebSocket for {call_id}")
    finally:
        await websocket.close()


@app.websocket("/ws")
async def client_websocket(websocket: WebSocket):
    """
    WebSocket for direct client connections (e.g., web UI testing).
    """
    await websocket.accept()
    logger.info("Client WebSocket connected")

    agent: Optional[VoiceLiveAgent] = None

    try:
        # Wait for start_call message with optional agenda
        message = await websocket.receive_json()
        if message.get("type") != "start_call":
            await websocket.send_json({"type": "error", "error": {"message": "Expected start_call message"}})
            return
        
        # Get agenda from message or use default instructions
        agenda = message.get("agenda") or Config.VOICELIVE_INSTRUCTIONS
        logger.info(f"Starting call with agenda: {agenda[:100]}...")

        credential = DefaultAzureCredential()
        agent = VoiceLiveAgent(
            endpoint=Config.VOICELIVE_ENDPOINT,
            credential=credential,
            model=Config.VOICELIVE_MODEL,
            voice=Config.VOICELIVE_VOICE,
            instructions=agenda,
            call_id="websocket-client",
            websocket=websocket,
        )

        await agent.start()

    except WebSocketDisconnect:
        logger.info("Client WebSocket disconnected")
    except Exception as e:
        logger.exception("Error in client WebSocket")
    finally:
        if agent:
            await agent.stop()


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=Config.PORT,
        reload=True,
        log_level="info"
    )
