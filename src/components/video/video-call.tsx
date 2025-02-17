'use client'

import { useState, useEffect, useRef } from 'react'
import { db } from '@/app/Firebase/config'
import { doc, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react'

const servers = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
}

interface VideoCallProps {
  callId: string
  currentUser: any
  otherUser: any
  onEndCall: () => void
  isDoctor: boolean
}

export default function VideoCall({ callId, currentUser, otherUser, onEndCall, isDoctor }: VideoCallProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [callStatus, setCallStatus] = useState<string>('connecting')

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const peerConnection = useRef<RTCPeerConnection | null>(null)

  useEffect(() => {
    async function startCall() {
      try {
        // Get local stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        })
        setLocalStream(stream)

        // Set up local video
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
        }

        // Create and set up peer connection
        const pc = new RTCPeerConnection(servers)
        peerConnection.current = pc

        // Add ICE candidate handling
        pc.onicecandidate = async (event) => {
          if (event.candidate) {
            await updateDoc(doc(db, 'calls', callId), {
              [`${currentUser.uid}_ice`]: arrayUnion(JSON.stringify(event.candidate))
            })
          }
        }

        // Add tracks to peer connection
        stream.getTracks().forEach(track => {
          pc.addTrack(track, stream)
        })

        // Set up remote video
        const remoteStream = new MediaStream()
        setRemoteStream(remoteStream)
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream
        }

        // Handle incoming tracks
        pc.ontrack = (event) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0]
          }
        }

        // Listen for call status changes
        const unsubscribe = onSnapshot(doc(db, 'calls', callId), async (snapshot) => {
          const data = snapshot.data()
          if (!data) return

          setCallStatus(data.status)

          try {
            if (isDoctor && data.status === 'accepted' && !data.offer) {
              // Create and send offer
              const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
              })
              await pc.setLocalDescription(offer)
              await updateDoc(doc(db, 'calls', callId), {
                offer: { type: offer.type, sdp: offer.sdp }
              })
            }

            if (!isDoctor && data.offer && !pc.currentRemoteDescription) {
              // Handle offer and create answer
              await pc.setRemoteDescription(new RTCSessionDescription(data.offer))
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              await updateDoc(doc(db, 'calls', callId), {
                answer: { type: answer.type, sdp: answer.sdp }
              })
            }

            if (isDoctor && data.answer && !pc.currentRemoteDescription) {
              // Handle answer
              await pc.setRemoteDescription(new RTCSessionDescription(data.answer))
            }

            // Handle ICE candidates
            const otherUserId = isDoctor ? otherUser.id : currentUser.uid
            const candidates = data[`${otherUserId}_ice`] || []
            if (Array.isArray(candidates)) {
              for (const iceString of candidates) {
                if (pc.remoteDescription) {
                  await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(iceString)))
                }
              }
            }
          } catch (error) {
            console.error('Error during call setup:', error)
          }
        })

        return () => {
          unsubscribe()
          stream.getTracks().forEach(track => track.stop())
          pc.close()
        }
      } catch (error) {
        console.error('Error starting call:', error)
      }
    }

    startCall()
  }, [callId, isDoctor, currentUser.uid, otherUser.id])

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setIsMuted(!isMuted)
    }
  }

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setIsVideoOff(!isVideoOff)
    }
  }

  const handleEndCall = async () => {
    try {
      await updateDoc(doc(db, 'calls', callId), {
        status: 'ended'
      })
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop())
      }
      if (peerConnection.current) {
        peerConnection.current.close()
      }
      onEndCall()
    } catch (error) {
      console.error('Error ending call:', error)
    }
  }

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg font-medium">
          Call with {otherUser.name}
        </CardTitle>
      </CardHeader>
      {callStatus === 'requesting' && !isDoctor && (
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Phone className="h-12 w-12 mx-auto mb-4 text-teal-600 animate-pulse" />
            <p>Waiting for {otherUser.name} to accept the call...</p>
          </div>
        </CardContent>
      )}
      {(callStatus === 'connected' || callStatus === 'accepted') && (
        <CardContent className="flex-1 grid grid-cols-2 gap-4 p-4">
          <div className="relative">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover rounded-lg"
            />
            <p className="absolute bottom-2 left-2 text-white text-sm bg-black/50 px-2 py-1 rounded">You</p>
          </div>
          <div className="relative">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover rounded-lg"
            />
            <p className="absolute bottom-2 left-2 text-white text-sm bg-black/50 px-2 py-1 rounded">
              {otherUser.name}
            </p>
          </div>
        </CardContent>
      )}
      <div className="p-4 border-t flex justify-center gap-4">
        <Button
          variant={isMuted ? "destructive" : "default"}
          size="icon"
          onClick={toggleMute}
        >
          {isMuted ? <MicOff /> : <Mic />}
        </Button>
        <Button
          variant={isVideoOff ? "destructive" : "default"}
          size="icon"
          onClick={toggleVideo}
        >
          {isVideoOff ? <VideoOff /> : <Video />}
        </Button>
        <Button
          variant="destructive"
          size="icon"
          onClick={handleEndCall}
        >
          <PhoneOff />
        </Button>
      </div>
    </Card>
  )
} 