import React, { useEffect, useRef, useState } from 'react';

const SERVER_PORT = 3000;

const ws = new WebSocket(`ws://localhost:${SERVER_PORT}`);

const VideoChat = () => {
    const [messages, setMessages] = useState([]);
    const [peers, setPeers] = useState({});
    const [localStream, setLocalStream] = useState(null);
    const videoRefs = useRef({});
    const inputRef = useRef();

    useEffect(() => {
        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'user-joined':
                    await callUser(data.id);
                    break;
                case 'signal':
                    await handleSignal(data);
                    break;
                case 'chat':
                    setMessages(m => [...m, `[${data.from}]: ${data.message}`]);
                    break;
                case 'file':
                    setMessages(m => [...m,
                        `[${data.from}] Shared: `
                        + `<a href=${data.fileUrl}" target="_blank">${data.fileName}</a>`
                    ]);
                    break;
            }
        };
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            setLocalStream(stream);
            const localVideo = document.getElementById('local');
            if (localVideo) localVideo.srcObject = stream;
            ws.send(JSON.stringify({ type: 'join', name: 'User' + Math.floor(Math.random() * 1000) }));
        });
    }, []);

    const handleSignal = async (data) => {
        const pc = peers[data.from] || createPeer(data.from);
        if (data.signal.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'signal', to: data.from, signal: pc.localDescription}));
        } else if (data.signal.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
        } else if (data.signal.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.signal));
        }
    }

    const createPeer = (id) => {
        const pc = new RTCPeerConnection();
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        pc.onicecandidate = e => {
            if (!e.candidate) return;
            ws.send(JSON.stringify({ type: 'signal', to: id, signal: e.candidate }));
        }
        pc.ontrack = e => {
            const stream = e.streams[0];
            videoRefs.current[id] = stream;
            setPeers(prev => ({ ...prev, [id]: pc }));
        };
        return pc;
    }

    const callUser = async (id) => {
        const pc = createPeer(id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: 'signal', to: id, signal: pc.localDescription }));
    }

    const sendChat = () => {
        ws.send(JSON.stringify({ type: 'chat', message: inputRef.current.value }));
        inputRef.current.value = '';
    };

    const sendFile = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = () => {
            const fileData = reader.reasult.split(',')[1];
            ws.send(JSON.stringify({
                type: 'file',
                fileName: file.name,
                fileData
            }));
        };
        reader.readAsDataURL(file);
    };

    return (
        <div>
            <h2>WebRTC Chat</h2>
            <video id="local" autoPlay muted width="200" />
            {Object.keys(videoRefs.current).map(id => (
                <video key={id} autoPlay
                    ref={(el) => { if (el) el.srcObject = videoRefs.current[id];}}
                    width = "200"
                />
            ))}
            <input ref={inputRef} placeholder="Message" />
            <button onClick={sendChat}>Send</button>
            <input type="file" onChange={sendFile} />
            <div dangerouslySetInnerHTML={{ __html: messages.join('<br>') }} />
        </div>
    );
}

export default VideoChat;
