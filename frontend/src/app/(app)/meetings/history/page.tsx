"use client";

import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Meeting } from "@/lib/types";
import { Card, Empty, PageHeader } from "@/components/ui";
import { MeetingRow } from "@/components/MeetingRow";

export default function History() {
  const { t } = useAuth();
  const list = useApi<Meeting[]>("/api/meetings?scope=history");
  return (
    <div>
      <PageHeader title={t("history")} subtitle="Records exist only for meetings where every participant consented to an official record." />
      <Card>
        {list.data?.length === 0 ? <Empty>{t("noItems")}</Empty> : (
          <ul className="divide-y divide-navy-700">{list.data?.map((m) => <MeetingRow key={m.id} m={m} />)}</ul>
        )}
      </Card>
    </div>
  );
}
