"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useRequireAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Meeting } from "@/lib/types";
import { Alert, Button, Spinner } from "@/components/ui";
import { Lobby, LobbyResult } from "@/components/meeting/Lobby";
import { Room } from "@/components/meeting/Room";

export default function LiveMeeting() {
  const { id } = useParams<{ id: string }>();
  const { me } = useRequireAuth("meeting.join");
  const router = useRouter();
  const meeting = useApi<Meeting>(me ? `/api/meetings/${id}` : null);
  const [joined, setJoined] = useState<LobbyResult | null>(null);

  if (!me || meeting.loading) return <Spinner />;
  if (meeting.error || !meeting.data)
    return (
      <div className="mx-auto max-w-lg p-10">
        <Alert tone="danger">{meeting.error || "Meeting not found"}</Alert>
        <Button className="mt-4" onClick={() => router.push("/dashboard")}>Back</Button>
      </div>
    );
  const m = meeting.data;
  if (m.status === "ended" || m.status === "cancelled")
    return (
      <div className="mx-auto max-w-lg p-10 text-center">
        <p className="font-serif text-2xl">This meeting is {m.status}.</p>
        <Button className="mt-4" onClick={() => router.push(`/meetings/history/${m.id}`)}>View record</Button>
      </div>
    );
  return joined ? <Room meeting={m} lobby={joined} /> : <Lobby meeting={m} onJoin={setJoined} />;
}
