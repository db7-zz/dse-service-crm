"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Breadcrumb, Typography } from "antd";

export function PageShell({
  title,
  section,
  breadcrumbs,
  description,
  extra,
  children,
}: {
  title: string;
  section?: string;
  breadcrumbs?: Array<{ title: string; href?: string }>;
  description?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={
          title === "工作区"
            ? [{ title: "工作区" }]
            : [
                { title: <Link href="/workspace">工作区</Link> },
                ...(breadcrumbs
                  ? breadcrumbs.map((item) => ({
                      title: item.href ? <Link href={item.href}>{item.title}</Link> : item.title,
                    }))
                  : section
                    ? [{ title: section }]
                    : []),
                { title },
              ]
        }
      />
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {description ? (
            <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
              {description}
            </Typography.Paragraph>
          ) : null}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}
