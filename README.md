# SFU group call app

```
choco install mkcert
mkdir ./.ssl/
cd ./.ssl/
mkcert -install -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 ::1 192.168.1.109
# copy and apply `C:\Users\I\AppData\Local\mkcert\rootCA.pem` on other
# devices for LAN testing
```

```
cd ./compose-node-react/
sudo docker-compose up --build
```

### Goals:
- Room feature:
    - toggle camera
    - toggle microphone
    - (non-priority) share screen
- Call feature:
    - P2P WebRTC streams
    - list online users
    - toggle user visibility
    - P2P call action via feed
    - P2P call action via link
- Group feature:
    - SFU server-managed streams
    - list online groups
    - toggle group visibility
    - "join room" action via feed
    - "join room" action via link
- (non-priority) Room upgrade feature to enable seamless call to group transition

### Props
- Amir Eshaq SFU [implementation](https://github.com/jamalag/mediasoup3)