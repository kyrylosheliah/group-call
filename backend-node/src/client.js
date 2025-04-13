const SERVER_PORT = 3000;

const socket = new WebSocket(`ws://localhost:${SERVER_PORT}`);
const peers = {};
let localStream;

navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
    localStream = stream;
    document.getElementById("local").srcObject = stream;
});

socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
        case 'user-joined':
            createOffer(data.id);
            break;

        case 'signal':
            if (data.signal.type === 'offer') {
                const pc = createPeerConnection(data.from);
                await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                sendSignal(data.from, pc.localDescription);
            } else if (data.signal.type === 'answer') {
                await peers[data.from].setRemoteDescription(new RTCSessionDescription(data.signal));
            } else if (data.signal.candidate) {
                await peers[data.from].addIceCandidate(new RTCIceCandidate(data.signal));
            }
            break;

        case 'chat':
            addToChat(`[${data.from}] ${data.message}`);
            break;

        case 'file':
            addToChat(`[${data.from}] Shared File: <a href="${data.fileUrl}" target="_blank"</a>`);
            break;
    }
}

function createPeerConnection(id) {
    const pc = new RTCPeerConnection();
    localStream.getTracks().forEach(track => pc.AddTrack(track, localStream));
    pc.onicecandidate = e => {
        if (e.candidate) sendSignal(id, e.candidate);
    };
    pc.ontrack = e => {
        const video = document.createElement("video");
        video.srcObject = e.streams[0];
        video.autoplay = true;
        document.body.appendChild(video);
    };
    peers[id] = pc;
    return pc;
}

async function createOffer(id) {
    const pc = createPeerConnection(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(id, offer);
}

function sendSignal(to, signal) {
    socket.send(JSON.stringify({ type: 'signal', to, signal }));
}

function sendMessage(message) {
    socket.send(JSON.stringify({ type: 'chat', message }));
}

function sendFile(file) {
    const reader = newFileReader();
    reader.onload = () => {
        const fileData = reader.result.split(',')[1];
        socket.send(JSON.stringify({
            type: 'file',
            fileName: file.name,
            fileData
        }));
        reader.readAsDataURL(file);
    }
}