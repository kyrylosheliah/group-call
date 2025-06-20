import { Accessor, createContext, useContext, type JSX } from "solid-js";
import { IUseCallRoomReturn, useCallRoom } from "~/hooks/useCallRoom";

const CallRoomContext = createContext<IUseCallRoomReturn>(
  useCallRoom({ roomName: () => "" })
);

export const useCallRoomContext = () => {
  return useContext(CallRoomContext);
};

export const CallRoomContextProvider = (params: {
  roomName: Accessor<string>;
  children: JSX.Element;
}) => (
  <CallRoomContext.Provider
    value={useCallRoom({ roomName: params.roomName })}
    children={params.children}
  />
);
