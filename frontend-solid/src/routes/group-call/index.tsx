import { useNavigate } from "@solidjs/router";
import { createSignal } from "solid-js";

export default function GroupCall() {
  const navigate = useNavigate();

  const [input, setInput] = createSignal("");
  const inputEmpty = () => input().length == 0;

  const join = () => {
    navigate(input());
  };

  return (
    <main class="text-center mx-auto text-gray-700 p-4">
      <input
        type="text"
        placeholder="room name ..."
        onInput={(e) => {
          setInput(e.target.value);
        }}
      />
      <button
        disabled={inputEmpty()}
        onClick={join}
        textContent={"join"}
      />
    </main>
  );
}
