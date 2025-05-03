import { useNavigate, useParams } from "@solidjs/router";
import GroupCall from "~/components/GroupCall";

export default function GroupCallRoom() {
  const params = useParams();

  const navigate = useNavigate();
  const leave = () => {
    navigate("../");
  };

  return (
    <main class="text-center mx-auto text-gray-700 p-4">
      <div><button onClick={leave}>Leave</button></div>
      <GroupCall roomName={params.id} />
    </main>
  );
}
