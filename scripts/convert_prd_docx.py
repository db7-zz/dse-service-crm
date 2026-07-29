"""Convert the approved DSE CRM Word PRD into a normalized Markdown baseline.

The source document uses the Word "Normal" style for most headings and list items,
so the converter restores structure from numbered headings and known section labels.
It intentionally normalizes product-level naming while leaving the source DOCX
untouched.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph


SECTION_LABELS = {
    "功能描述",
    "用户故事",
    "前置条件",
    "页面/交互逻辑",
    "后端逻辑/数据处理",
    "校验规则",
    "业务规则",
    "异常流程",
    "权限原则",
    "接口建议：",
    "计算规则：",
    "任务联动：",
    "信息隔离：",
    "数据返回规则：",
    "日志范围：",
}


def normalize_text(text: str) -> str:
    normalized = text.replace("Eric", "业务负责人").replace("eric", "manager")
    replacements = (
        ("业务负责人工作看板", "监督管理看板"),
        ("业务负责人逾期看板", "监督管理看板"),
        ("业务负责人看板", "监督管理看板"),
        ("业务负责人监督中心", "监督管理端"),
        ("业务负责人端", "监督管理端"),
        ("/api/dashboard/manager/", "/api/dashboard/supervision/"),
    )
    for old, new in replacements:
        normalized = normalized.replace(old, new)
    return normalized.rstrip()


def heading_level(text: str) -> int | None:
    if re.match(r"^\d+\.\d+\.\d+\s+\S", text):
        return 4
    if re.match(r"^\d+\.\d+\s+\S", text):
        return 3
    if re.match(r"^\d+\.\s+\S", text):
        return 2
    if text in SECTION_LABELS or text.rstrip("：") in {item.rstrip("：") for item in SECTION_LABELS}:
        return 4
    if text == "文档结论":
        return 2
    return None


def markdown_table(table: Table) -> list[str]:
    rows: list[list[str]] = []
    for row in table.rows:
        rows.append(
            [
                normalize_text(cell.text).replace("\n", "<br>").replace("|", "\\|").strip()
                for cell in row.cells
            ]
        )
    if not rows:
        return []
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    lines = ["| " + " | ".join(padded[0]) + " |"]
    lines.append("| " + " | ".join("---" for _ in range(width)) + " |")
    lines.extend("| " + " | ".join(row) + " |" for row in padded[1:])
    return lines


def is_metadata_paragraph(text: str) -> bool:
    return "文档版本：" in text and "需求基线：" in text


def should_be_bullet(text: str) -> bool:
    if len(text) > 180:
        return False
    if text.endswith("；"):
        return True
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*(：.*)?$", text):
        return True
    return False


def convert(source: Path, output: Path) -> None:
    document = Document(source)
    blocks = list(document.iter_inner_content())
    lines: list[str] = [
        "# DSE升学服务CRM 产品需求文档（PRD）",
        "",
        "> **Status:** Approved Baseline  ",
        "> **Version:** Product PRD V1.0  ",
        "> **Baseline Date:** 2026-07-28  ",
        "> **Source:** PRD开发文档.docx（原文件保持不变）",
        "",
        "## 基线解释与命名规则",
        "",
        "- 系统页面统一使用“管理员端”“监督管理端”和“监督管理看板”。",
        "- `ERIC_MANAGER` 是业务负责人角色代码，不作为整套页面或系统端名称。",
        "- 本文描述最终产品边界；阶段交付范围与首版临时规则以对应增量PRD为准。",
        "- 阶段1延期报备提交后立即生效并进入监督管理看板，不引入审批流程。",
        "- 阶段5首版仅提供学生账号；家长独立账号和复杂授权不在V1.0范围。",
        "- 首版仅提供站内通知，不接入短信、微信或企业微信。",
        "- 资料和申请阻塞规则分别在阶段3和阶段4接入阶段计算。",
        "",
    ]

    index = 0
    while index < len(blocks):
        block = blocks[index]
        if isinstance(block, Table):
            lines.extend(markdown_table(block))
            lines.append("")
            index += 1
            continue

        if not isinstance(block, Paragraph):
            index += 1
            continue

        raw = block.text.strip()
        if not raw or raw.startswith("DSE升学服务CRM 产品需求文档"):
            index += 1
            continue
        if is_metadata_paragraph(raw):
            index += 1
            continue

        text = normalize_text(raw)
        if text.startswith("flowchart "):
            mermaid_lines = [text]
            index += 1
            while index < len(blocks):
                following = blocks[index]
                if not isinstance(following, Paragraph):
                    break
                following_text = normalize_text(following.text.rstrip())
                if following_text and heading_level(following_text) is not None:
                    break
                mermaid_lines.append(following_text)
                index += 1
            lines.extend(["```mermaid", *mermaid_lines, "```", ""])
            continue

        level = heading_level(text)
        if level is not None:
            lines.extend([f"{'#' * level} {text.rstrip('：')}", ""])
        elif should_be_bullet(text):
            lines.append(f"- {text.rstrip('；')}")
        else:
            lines.extend([text, ""])
        index += 1

    output.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(lines).rstrip() + "\n"
    output.write_text(content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    convert(arguments.source, arguments.output)


if __name__ == "__main__":
    main()
