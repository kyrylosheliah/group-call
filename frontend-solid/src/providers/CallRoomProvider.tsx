import { Accessor, createContext, useContext, type JSX } from "solid-js";
import { IUseCallRoomReturn, useCallRoom } from "~/hooks/useCallRoom";

const CallRoomContext = createContext<IUseCallRoomReturn>(useCallRoom());

export const useCallRoomContext = () => {
  return useContext(CallRoomContext);
};

export const CallRoomContextProvider = (params: {
  children: JSX.Element;
}) => (
  <CallRoomContext.Provider
    value={useCallRoom()}
    children={params.children}
  />
);
