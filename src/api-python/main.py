# -------------------------------------------------------------------------
# Voice Live Agent - Phone Call Integration
# Integrates Azure VoiceLive SDK with ACS Call Automation for real phone calls
# -------------------------------------------------------------------------
from __future__ import annotations
import os
import asyncio
import base64
import logging
import time
from datetime import datetime
from typing import Optional, Dict, Any, List
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
from azure.communication.phonenumbers.aio import PhoneNumbersClient
from azure.storage.blob.aio import BlobServiceClient

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
        "You are Ava, an AI voice assistant. Be concise, friendly, and professional. Start speaking in English. If the user responds in a different language, seamlessly switch to their language for the rest of the conversation."
    )
    ACS_ENDPOINT = os.getenv("AZURE_COMMUNICATION_ENDPOINT", "")
    ACS_PHONE_NUMBER = os.getenv("ACS_PHONE_NUMBER", "")
    AZURE_STORAGE_ACCOUNT_NAME = os.getenv("AZURE_STORAGE_ACCOUNT_NAME", "")
    CALLBACK_URI = os.getenv("CALLBACK_URI", "http://localhost:8000")
    PORT = int(os.getenv("PORT", "8000"))


# Active calls storage
active_calls: Dict[str, Dict[str, Any]] = {}
active_agents: Dict[str, VoiceLiveAgent] = {}
active_media_websockets: Dict[str, WebSocket] = {}  # Store media websockets for sending audio back
call_transcripts: Dict[str, list] = {}  # Store transcripts per call
transcript_subscribers: Dict[str, list] = {}  # SSE subscribers per call
call_recordings: Dict[str, Dict[str, Any]] = {}  # Store recording metadata per call

# Current inbound agent instructions (can be updated via API)
inbound_agent_instructions: str = Config.VOICELIVE_INSTRUCTIONS

# Storage client for recordings
blob_service_client: Optional[BlobServiceClient] = None

# Cached phone numbers (fetched dynamically from ACS)
cached_phone_numbers: List[str] = []
phone_numbers_last_fetched: Optional[datetime] = None
PHONE_CACHE_TTL_SECONDS = 300  # Cache for 5 minutes


async def get_acs_phone_numbers() -> List[str]:
    """
    Dynamically fetch purchased phone numbers from Azure Communication Services.
    Returns cached results if available and not expired.
    """
    global cached_phone_numbers, phone_numbers_last_fetched
    
    # Check cache
    if (phone_numbers_last_fetched and 
        cached_phone_numbers and
        (datetime.now() - phone_numbers_last_fetched).total_seconds() < PHONE_CACHE_TTL_SECONDS):
        return cached_phone_numbers
    
    if not Config.ACS_ENDPOINT:
        logger.warning("ACS endpoint not configured, cannot fetch phone numbers")
        return []
    
    try:
        credential = DefaultAzureCredential()
        async with PhoneNumbersClient(Config.ACS_ENDPOINT, credential) as phone_client:
            phone_numbers = []
            async for number in phone_client.list_purchased_phone_numbers():
                phone_numbers.append(number.phone_number)
            
            cached_phone_numbers = phone_numbers
            phone_numbers_last_fetched = datetime.now()
            logger.info(f"Fetched {len(phone_numbers)} phone numbers from ACS: {phone_numbers}")
            return phone_numbers
    except Exception as e:
        logger.warning(f"Failed to fetch phone numbers from ACS: {e}")
        # Return cached if available, even if expired
        return cached_phone_numbers


async def get_default_phone_number() -> Optional[str]:
    """
    Get the default phone number to use for outbound calls.
    Priority: 1) ACS_PHONE_NUMBER env var, 2) First purchased number from ACS
    """
    # Check env var first
    if Config.ACS_PHONE_NUMBER:
        return Config.ACS_PHONE_NUMBER
    
    # Try to fetch from ACS
    numbers = await get_acs_phone_numbers()
    if numbers:
        return numbers[0]
    
    return None


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
    global blob_service_client
    
    logger.info("Starting Voice Live Agent Server")
    logger.info(f"VoiceLive Endpoint: {Config.VOICELIVE_ENDPOINT}")
    logger.info(f"ACS Endpoint: {Config.ACS_ENDPOINT}")
    
    # Initialize blob storage client for recordings using managed identity
    if Config.AZURE_STORAGE_ACCOUNT_NAME:
        try:
            credential = DefaultAzureCredential()
            blob_url = f"https://{Config.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net"
            blob_service_client = BlobServiceClient(account_url=blob_url, credential=credential)
            # Ensure recordings container exists
            container_client = blob_service_client.get_container_client("recordings")
            try:
                await container_client.get_container_properties()
                logger.info("Recordings container found")
            except Exception:
                logger.info("Creating recordings container")
                await blob_service_client.create_container("recordings")
            logger.info("Blob storage client initialized for call recordings (using managed identity)")
        except Exception as e:
            logger.warning(f"Failed to initialize blob storage client: {e}")
    
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
    
    # Close blob storage client
    if blob_service_client:
        await blob_service_client.__aexit__(None, None, None)
        logger.info("Blob storage client closed")


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
    # Dynamically fetch phone numbers from ACS
    phone_numbers = await get_acs_phone_numbers()
    default_number = await get_default_phone_number()
    
    return {
        "inbound_phone_number": default_number,
        "phone_numbers": phone_numbers,
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

        # Use provided source or dynamically get default phone number
        source_number = request.source_phone_number
        if not source_number:
            source_number = await get_default_phone_number()
        if not source_number:
            raise HTTPException(status_code=400, detail="No source phone number configured. Purchase a phone number in Azure Portal.")

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

        # Event Grid sends events as an array
        if not isinstance(body, list):
            body = [body]

        # Handle Event Grid validation
        if len(body) > 0:
            event = body[0]
            if event.get("eventType") == "Microsoft.EventGrid.SubscriptionValidationEvent":
                validation_code = event["data"]["validationCode"]
                return JSONResponse({"validationResponse": validation_code})

        # Extract the incoming call event data
        if len(body) == 0:
            raise HTTPException(status_code=400, detail="No events in request")

        event = body[0]
        event_data = event.get("data", {})
        incoming_call_context = event_data.get("incomingCallContext")
        
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

        # Extract caller info from event data
        from_info = event_data.get("from", {})
        caller_number = from_info.get("phoneNumber", {}).get("value") if isinstance(from_info.get("phoneNumber"), dict) else from_info.get("rawId", "unknown")

        active_calls[call_id] = {
            "call_connection_id": call_connection_id,
            "status": "connected",
            "direction": "inbound",
            "phone_number": caller_number,
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
                    
                    # Start call recording
                    try:
                        await start_call_recording(call_connection_id)
                    except Exception as e:
                        logger.warning(f"Failed to start call recording: {e}")
                    
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
                    # Stop call recording
                    try:
                        await stop_call_recording(call_connection_id)
                    except Exception as e:
                        logger.warning(f"Failed to stop call recording: {e}")
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


@app.get("/api/calls/{call_id}/recording")
async def get_call_recording(call_id: str):
    """
    Get recording URL for a call.
    Returns a SAS URL to download the recording from blob storage using managed identity.
    """
    try:
        recording_info = call_recordings.get(call_id)
        
        if not recording_info:
            return {
                "callId": call_id,
                "recordingUrl": None,
                "status": "no_recording",
                "message": "No recording found for this call"
            }
        
        if recording_info["status"] == "recording":
            return {
                "callId": call_id,
                "recordingUrl": None,
                "status": "recording_in_progress",
                "message": "Call is still being recorded"
            }
        
        if recording_info["status"] == "failed":
            return {
                "callId": call_id,
                "recordingUrl": None,
                "status": "failed",
                "message": recording_info.get("error", "Recording failed")
            }
        
        # Recording completed - generate SAS URL using managed identity
        blob_name = recording_info.get("blob_name")
        if blob_name and Config.AZURE_STORAGE_ACCOUNT_NAME:
            try:
                from datetime import timedelta
                
                # Generate SAS URL valid for 1 hour using managed identity
                credential = DefaultAzureCredential()
                expiry = datetime.utcnow() + timedelta(hours=1)
                
                # For managed identity, we need account key approach - use blob client
                blob_client = blob_service_client.get_blob_client(
                    container="recordings",
                    blob=blob_name
                )
                
                # Get account key from blob properties (requires Storage Blob Data Contributor)
                # Alternative: Use SAS token generated via account key (if available in env)
                # For pure managed identity without keys, construct download URL with managed identity auth
                recording_url = f"https://{Config.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/recordings/{blob_name}"
                
                return {
                    "callId": call_id,
                    "recordingUrl": recording_url,
                    "status": "completed",
                    "message": "Recording available for download",
                    "blobName": blob_name,
                    "auth": "managed-identity"
                }
            except Exception as e:
                logger.exception(f"Failed to generate recording URL for {blob_name}: {e}")
                return {
                    "callId": call_id,
                    "recordingUrl": None,
                    "status": "completed",
                    "blobName": blob_name,
                    "message": "Recording completed but URL generation failed"
                }
        
        return {
            "callId": call_id,
            "recordingUrl": None,
            "status": "completed",
            "message": "Recording completed but unable to generate download URL"
        }
        
    except Exception as e:
        logger.exception(f"Failed to get recording for call {call_id}")
        return {
            "callId": call_id,
            "recordingUrl": None,
            "status": "error",
            "message": str(e)
        }


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


async def start_call_recording(call_id: str):
    """
    Start recording for a call using ACS Call Recording API.
    Note: Recording functionality is not fully implemented yet.
    """
    # Recording functionality requires additional setup (connection string, recording types)
    # For now, just log that recording is not available
    logger.info(f"Call recording not configured for {call_id}")
    call_recordings[call_id] = {
        "status": "not_configured",
        "message": "Call recording not enabled"
    }


async def stop_call_recording(call_id: str):
    """
    Stop recording for a call.
    """
    if call_id not in call_recordings:
        logger.warning(f"No recording metadata found for {call_id}")
        return
    
    try:
        recording_info = call_recordings[call_id]
        if recording_info.get("status") != "recording":
            logger.info(f"Call {call_id} not being recorded")
            return
        
        credential = DefaultAzureCredential()
        call_client = CallAutomationClient(Config.ACS_ENDPOINT, credential)
        call_connection = call_client.get_call_connection(call_id)
        
        # Stop recording
        await call_connection.stop_recording()
        
        # Update recording metadata
        call_recordings[call_id]["status"] = "completed"
        call_recordings[call_id]["stop_time"] = datetime.now().isoformat()
        
        logger.info(f"Stopped recording for call {call_id}")
        
    except Exception as e:
        logger.exception(f"Failed to stop recording for {call_id}")
        if call_id in call_recordings:
            call_recordings[call_id]["status"] = "failed"
            call_recordings[call_id]["error"] = str(e)


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
                        
                        # Set callback for barge-in to immediately stop phone audio
                        async def barge_in_callback():
                            await stop_audio_on_phone(current_call_id)
                        agent.set_barge_in_callback(barge_in_callback)
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


async def stop_audio_on_phone(call_id: str):
    """
    Send StopAudio message to ACS to immediately clear queued audio playback.
    This is critical for barge-in to work properly - stops any buffered audio.
    """
    websocket = active_media_websockets.get(call_id)
    if websocket:
        try:
            await websocket.send_json({
                "kind": "StopAudio",
                "audioData": None,
                "stopAudio": {}
            })
            logger.info(f"Sent StopAudio to phone {call_id} (barge-in)")
        except Exception as e:
            logger.error(f"Failed to send StopAudio to phone {call_id}: {e}")
    else:
        logger.warning(f"No websocket found for call {call_id} to stop audio")


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
    heartbeat_task: Optional[asyncio.Task] = None
    heartbeat_stop = asyncio.Event()

    try:
        # Wait for start_call message with optional agenda
        message = await websocket.receive_json()
        if message.get("type") != "start_call":
            await websocket.send_json({"type": "error", "error": {"message": "Expected start_call message"}})
            return
        
        # Get agenda from message or use default instructions
        agenda = message.get("agenda") or Config.VOICELIVE_INSTRUCTIONS
        logger.info(f"Starting call with agenda: {agenda[:100]}...")

        # Send immediate acknowledgment to keep connection alive while initializing
        call_id = f"ws-{int(time.time())}"
        await websocket.send_json({"type": "initializing", "callId": call_id})

        # Heartbeat to keep the socket alive during initialization
        async def heartbeat() -> None:
            while not heartbeat_stop.is_set():
                await asyncio.sleep(0.5)
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception as e:
                    logger.info(f"[{call_id}] Heartbeat stopped: {e}")
                    break

        heartbeat_task = asyncio.create_task(heartbeat())

        credential = DefaultAzureCredential()
        agent = VoiceLiveAgent(
            endpoint=Config.VOICELIVE_ENDPOINT,
            credential=credential,
            model=Config.VOICELIVE_MODEL,
            voice=Config.VOICELIVE_VOICE,
            instructions=agenda,
            call_id=call_id,
            websocket=websocket,
        )

        # Start agent in background task
        agent_task = asyncio.create_task(agent.start())
        
        # Wait for agent to be ready
        for _ in range(20):  # Wait up to 10 seconds
            if agent.session_ready:
                break
            # Check if agent task has failed
            if agent_task.done():
                try:
                    agent_task.result()  # This will raise if the task failed
                except Exception as e:
                    logger.exception(f"Agent task failed before ready: {e}")
                    await websocket.send_json({"type": "error", "error": {"message": f"Agent startup failed: {e}"}})
                    return
            await asyncio.sleep(0.5)
        
        if not agent.session_ready:
            await websocket.send_json({"type": "error", "error": {"message": "Agent failed to start"}})
            return
        
        # Stop heartbeat once agent is ready
        heartbeat_stop.set()
        if heartbeat_task:
            await heartbeat_task

        logger.info(f"[{call_id}] Agent ready, sending initial messages to client")
        # Send call_started message to notify client
        await websocket.send_json({
            "type": "call_started",
            "callId": call_id,
            "session_id": agent.session_id if hasattr(agent, 'session_id') else None,
        })
        # Send ready message so client knows it's safe to start sending audio
        await websocket.send_json({"type": "ready"})
        
        # Now allow agent to send messages to websocket
        agent.websocket_ready = True
        logger.info(f"Agent ready, entering message loop")
        
        # Handle incoming messages from client
        try:
            async for message in websocket.iter_json():
                msg_type = message.get("type")
                
                if msg_type == "audio":
                    # Audio from client microphone
                    audio_data = message.get("data")
                    if audio_data and agent.connection and agent.session_ready:
                        await agent.send_audio(audio_data)
                
                elif msg_type == "end_call":
                    await agent.stop()
                    await websocket.send_json({"type": "call_ended"})
                    break
        except WebSocketDisconnect as e:
            logger.info(f"Client disconnected during message loop (code={e.code})")
        except RuntimeError as e:
            logger.info(f"Client websocket closed during message loop: {e}")
        except Exception as e:
            logger.exception(f"Error in message loop: {e}")
        finally:
            logger.info("Stopping agent due to message loop exit")
            await agent.stop()
            if not agent_task.done():
                agent_task.cancel()
                try:
                    await agent_task
                except asyncio.CancelledError:
                    pass
            # Check if agent task failed after stopping
            if agent_task.done() and not agent_task.cancelled():
                try:
                    agent_task.result()
                except Exception as e:
                    logger.exception(f"Agent task failed: {e}")

    except WebSocketDisconnect as e:
        logger.info(f"Client WebSocket disconnected (code={e.code})")
    except RuntimeError:
        logger.info("Client WebSocket closed")
    except Exception as e:
        logger.exception("Error in client WebSocket")
        try:
            await websocket.send_json({"type": "error", "error": {"message": str(e)}})
        except:
            pass
    finally:
        heartbeat_stop.set()
        if heartbeat_task:
            try:
                await heartbeat_task
            except Exception:
                pass
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
