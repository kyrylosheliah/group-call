import "@unocss/reset/tailwind.css";
import "virtual:uno.css";
import "./app.css";

import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { CallRoomContextProvider } from "~/providers/CallRoomProvider";

export default function App() {
  return (
    <Router
      root={(props) => (
        <>
          <Suspense>
            <CallRoomContextProvider>{props.children}</CallRoomContextProvider>
          </Suspense>
        </>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
