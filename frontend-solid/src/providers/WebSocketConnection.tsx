import { Component, createContext, JSX, onMount, useContext } from "solid-js";
import { createStore } from "solid-js/store";

export const getServerWebSocketURL = () => `ws://192.168.1.109:3000`;

const connect = () => new WebSocket(getServerWebSocketURL());

const ServerWebSocketContext = createContext(
  createStore<WebSocket>(
    connect()
  )
);

export const useServerWebSocket = () => {
  return useContext(ServerWebSocketContext);
};

export const reconnectServerWebSocket = () => {
  const [socket, setSocket] = useServerWebSocket();
  socket.close();
  setSocket(connect());
}

export const ServerWebSocketConnectionProvider: Component<{ children: JSX.Element }> = (props) => {
  // enforce single connection per web app
  const [socket, setSocket] = useServerWebSocket();

  onMount(() => {
    socket.onerror = (event: Event) => {
      console.log("error establishing socket", event);
    };
    if (socket.CLOSED || socket.CLOSING) {
      console.log("server web socket connection error");
    }
  });

  return (
    <ServerWebSocketContext.Provider value={[ socket, setSocket ]}>
      {props.children}
    </ServerWebSocketContext.Provider>
  );
};
