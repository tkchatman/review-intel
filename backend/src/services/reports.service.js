import { prisma } from "../lib/prisma.js";
import { analyzeSavedReviewsForBusiness } from "./savedReviewAnalysis.service.js";

const cadenceDays = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 30,
};

function rangeForCadence(cadence, now = new Date()) {
  const end = now;
  const start = new Date(now);
  start.setDate(start.getDate() - cadenceDays[cadence]);
  return { start, end };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function friendlyList(items, emptyMessage) {
  return asArray(items).length ? items : [{ label: emptyMessage, value: "No repeated pattern yet", count: 0 }];
}

function buildReportContent({ businessProfile, analysis, cadence, dateRangeStart, dateRangeEnd }) {
  const raw = analysis.rawPayload ?? {};
  const topCompliments = friendlyList(
    analysis.topCompliments ?? raw.topCompliments,
    "Not enough compliment data available yet.",
  );
  const topComplaints = friendlyList(
    analysis.topComplaints ?? raw.topComplaints,
    "Not enough complaint data available yet.",
  );
  const recommendations = asArray(raw.recommendations).length
    ? raw.recommendations
    : [analysis.recommendation ?? raw.recommendation ?? "Collect more review data before making operational recommendations."];
  const score = analysis.pulseScore ?? raw.sentimentScore ?? raw.pulseScore ?? null;
  const rating =
    analysis.rating !== null && analysis.rating !== undefined
      ? Number(analysis.rating)
      : raw.rating ?? (businessProfile.rating !== null && businessProfile.rating !== undefined ? Number(businessProfile.rating) : null);
  const reviewsAnalyzed = analysis.inputReviewCount ?? raw.reviewsAnalyzed ?? 0;
  const sentiment = analysis.sentimentBreakdown ?? raw.sentimentBreakdown ?? {
    positive: 0,
    neutral: 0,
    negative: 0,
  };

  return {
    cadence,
    business: {
      id: businessProfile.id,
      name: businessProfile.displayName,
      address: businessProfile.formattedAddress,
      category: businessProfile.primaryCategory,
    },
    dateRange: {
      start: dateRangeStart.toISOString(),
      end: dateRangeEnd.toISOString(),
    },
    sections: {
      overview: {
        rating,
        customerScore: score,
        reviewsAnalyzed,
        summary: analysis.summary ?? raw.aiSummary ?? "Not enough review data available yet.",
      },
      sourceBreakdown: raw.sourceBreakdown ?? {},
      sentiment,
      positiveThemes: topCompliments,
      negativeThemes: topComplaints,
      topComplaints,
      topCompliments,
      actionItems: recommendations,
      trendSummary: analysis.trendSummary ?? raw.trendSummary ?? "Not enough historical data available for trend analysis yet.",
      trends: raw.trends ?? null,
    },
  };
}

function reportSummary(content) {
  const overview = content.sections.overview;
  return `${content.business.name} ${content.cadence.toLowerCase()} report: ${overview.reviewsAnalyzed} reviews analyzed. ${overview.summary}`;
}

export async function getBusinessProfileForUser({ userId, businessProfileId }) {
  return prisma.businessProfile.findFirst({
    where: {
      id: businessProfileId,
      userId,
    },
  });
}

export async function generateReport({ userId, businessProfileId, cadence }) {
  const businessProfile = await getBusinessProfileForUser({ userId, businessProfileId });

  if (!businessProfile) {
    const error = new Error("Selected business was not found for this account.");
    error.statusCode = 404;
    throw error;
  }

  let analysis = await prisma.analysisResult.findFirst({
    where: { businessProfileId },
    orderBy: { generatedAt: "desc" },
  });

  if (!analysis) {
    const generated = await analyzeSavedReviewsForBusiness(businessProfileId);
    analysis = generated.analysisResult;
  }

  const { start, end } = rangeForCadence(cadence);
  const content = buildReportContent({
    businessProfile,
    analysis,
    cadence,
    dateRangeStart: start,
    dateRangeEnd: end,
  });

  return prisma.report.create({
    data: {
      userId,
      businessProfileId,
      analysisResultId: analysis.id,
      cadence,
      status: "GENERATED",
      title: `${businessProfile.displayName} ${cadence.toLowerCase()} review intelligence report`,
      subject: `${businessProfile.displayName} ${cadence.toLowerCase()} Review Intel Care Report`,
      previewBody: reportSummary(content),
      dateRangeStart: start,
      dateRangeEnd: end,
      rawPayload: content,
      generatedAt: new Date(),
      emailStatus: "NOT_CONFIGURED",
    },
    include: {
      businessProfile: true,
    },
  });
}

export async function listReports({ userId, businessProfileId }) {
  return prisma.report.findMany({
    where: {
      userId,
      ...(businessProfileId ? { businessProfileId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { businessProfile: true },
  });
}

export async function getReportForUser({ userId, reportId }) {
  return prisma.report.findFirst({
    where: {
      id: reportId,
      userId,
    },
    include: {
      businessProfile: true,
      analysisResult: true,
    },
  });
}

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/[\\()]/g, "\\$&");
}

function toTitleCase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b([a-z][a-z']*)/g, (word) => {
      if (/^[A-Z0-9]+$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

function wrapText(value, maxChars = 84) {
  const words = String(value ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function themeLines(themes, emptyMessage) {
  if (!themes?.length) return [toTitleCase(emptyMessage)];
  return themes.map((theme) => `${toTitleCase(theme.label)}${theme.value ? ` - ${toTitleCase(theme.value)}` : ""}`);
}

function sourceLabel(source) {
  const labels = {
    google_places: "Google Places",
    google_business_profile: "Google Business Profile",
    facebook: "Facebook",
    yelp: "Yelp",
    tripadvisor: "TripAdvisor",
    instagram: "Instagram",
    app_store: "App Store",
  };

  return labels[source] ?? toTitleCase(String(source).replaceAll("_", " "));
}

export function reportToPdfBuffer(report) {
  const content = report.rawPayload ?? {};
  const sections = content.sections ?? {};
  const overview = sections.overview ?? {};
  const sentiment = sections.sentiment ?? { positive: 0, neutral: 0, negative: 0 };
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 42;
  const bottom = 50;
  const cardWidth = pageWidth - margin * 2;
  const pages = [];
  let commands = [];
  let y = pageHeight - margin;

  const setFill = (r, g, b) => commands.push(`${r} ${g} ${b} rg`);
  const setStroke = (r, g, b) => commands.push(`${r} ${g} ${b} RG`);
  const rect = (x, rectY, w, h, color) => {
    setFill(...color);
    commands.push(`${x} ${rectY} ${w} ${h} re f`);
  };
  const line = (x1, y1, x2, y2, color = [0.067, 0.078, 0.067], width = 1) => {
    setStroke(...color);
    commands.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const text = (value, x, textY, size = 10, color = [0.067, 0.078, 0.067]) => {
    setFill(...color);
    commands.push(`BT /F1 ${size} Tf ${x} ${textY} Td (${escapePdfText(value)}) Tj ET`);
  };
  const finishPage = () => {
    pages.push(commands.join("\n"));
    commands = [];
    y = pageHeight - margin;
  };
  const ensure = (height) => {
    if (y - height < bottom) finishPage();
  };
  const drawHeader = () => {
    rect(margin, y - 92, cardWidth, 92, [0.067, 0.078, 0.067]);
    rect(margin + 18, y - 48, 28, 28, [0.780, 0.635, 0.227]);
    text("RI", margin + 24, y - 39, 10, [0.067, 0.078, 0.067]);
    text(toTitleCase(report.title), margin + 58, y - 34, 18, [1, 1, 1]);
    text(`${toTitleCase(content.business?.name ?? report.businessProfile?.displayName ?? "")} | ${toTitleCase(report.cadence)} | ${report.dateRangeStart?.toISOString?.().slice(0, 10) ?? ""} To ${report.dateRangeEnd?.toISOString?.().slice(0, 10) ?? ""}`, margin + 58, y - 60, 10, [0.846, 0.867, 0.910]);
    y -= 116;
  };
  const drawMetric = (label, value, note, x, metricY, width) => {
    rect(x, metricY - 86, width, 86, [0.969, 0.969, 0.949]);
    rect(x, metricY - 4, width, 4, [0.780, 0.635, 0.227]);
    rect(x + 12, metricY - 32, 22, 22, [0.780, 0.635, 0.227]);
    text(toTitleCase(label), x + 44, metricY - 24, 9, [0.400, 0.440, 0.520]);
    text(value, x + 12, metricY - 54, 20);
    text(toTitleCase(note), x + 12, metricY - 73, 8, [0.400, 0.440, 0.520]);
  };
  const drawMetrics = () => {
    ensure(100);
    const gap = 12;
    const width = (cardWidth - gap) / 2;
    drawMetric("Overall Rating", overview.rating ?? "N/A", "Average public rating", margin, y, width);
    drawMetric("Customer Score", overview.customerScore ?? "N/A", "Review intelligence score", margin + width + gap, y, width);
    y -= 100;
    drawMetric("Reviews Analyzed", overview.reviewsAnalyzed ?? 0, "Reviews used in this report", margin, y, width);
    drawMetric("Sentiment", `${sentiment.positive ?? 0} / ${sentiment.neutral ?? 0} / ${sentiment.negative ?? 0}`, "Positive / Neutral / Negative", margin + width + gap, y, width);
    y -= 112;
  };
  const drawSection = (title, badge, lines) => {
    const wrapped = lines.flatMap((line) => wrapText(toTitleCase(line), 90));
    const height = 56 + wrapped.length * 15;
    ensure(height + 12);
    rect(margin, y - height, cardWidth, height, [1, 1, 1]);
    rect(margin, y - height, 5, height, [0.780, 0.635, 0.227]);
    rect(margin + 16, y - 34, 24, 24, [0.780, 0.635, 0.227]);
    text(badge, margin + 24, y - 26, 8, [0.067, 0.078, 0.067]);
    text(toTitleCase(title), margin + 50, y - 26, 13);
    let lineY = y - 54;
    for (const line of wrapped) {
      text(line, margin + 18, lineY, 10, [0.260, 0.300, 0.380]);
      lineY -= 15;
    }
    y -= height + 16;
  };
  const drawSourcesChart = () => {
    const entries = Object.entries(sections.sourceBreakdown ?? {});
    const lines = entries.length
      ? entries.map(([source, count]) => `${sourceLabel(source)} - ${count} Reviews`)
      : ["Not Enough Data Available Yet"];
    drawSection("Review Sources", "R", lines);
  };
  const drawBarChart = (title, badge, themes, emptyMessage) => {
    const items = themes?.length ? themes.slice(0, 5) : [];
    const height = items.length ? 64 + items.length * 34 : 82;
    ensure(height + 12);
    rect(margin, y - height, cardWidth, height, [1, 1, 1]);
    rect(margin, y - height, 5, height, [0.780, 0.635, 0.227]);
    rect(margin + 16, y - 34, 24, 24, [0.780, 0.635, 0.227]);
    text(badge, margin + 24, y - 26, 8, [0.067, 0.078, 0.067]);
    text(toTitleCase(title), margin + 50, y - 26, 13);
    if (!items.length) {
      text(toTitleCase(emptyMessage), margin + 18, y - 58, 10, [0.400, 0.440, 0.520]);
      y -= height + 16;
      return;
    }
    const maxCount = Math.max(...items.map((item) => item.count || 1));
    let rowY = y - 58;
    for (const item of items) {
      const barWidth = Math.max(36, ((item.count || 1) / maxCount) * (cardWidth - 190));
      text(toTitleCase(item.label), margin + 18, rowY, 9);
      rect(margin + 150, rowY - 4, cardWidth - 190, 8, [0.910, 0.890, 0.820]);
      rect(margin + 150, rowY - 4, barWidth, 8, [0.780, 0.635, 0.227]);
      text(toTitleCase(item.value ?? `${item.count ?? 0} Mentions`), margin + cardWidth - 34, rowY, 8, [0.400, 0.440, 0.520]);
      rowY -= 34;
    }
    y -= height + 16;
  };
  const drawComplaintBreakdown = () => {
    drawBarChart("Complaint Breakdown", "C", sections.topComplaints, "Not Enough Complaint Data Available Yet");
  };
  const drawTrendChart = () => {
    const monthlyCounts = sections.trends?.monthlyReviewCounts;
    const entries = monthlyCounts ? Object.entries(monthlyCounts).sort(([a], [b]) => a.localeCompare(b)).slice(-6) : [];
    const height = 160;
    ensure(height + 12);
    rect(margin, y - height, cardWidth, height, [1, 1, 1]);
    rect(margin, y - height, 5, height, [0.780, 0.635, 0.227]);
    rect(margin + 16, y - 34, 24, 24, [0.780, 0.635, 0.227]);
    text("T", margin + 24, y - 26, 8, [0.067, 0.078, 0.067]);
    text("Complaint Trends", margin + 50, y - 26, 13);
    if (entries.length < 2) {
      text("Not Enough Data Available Yet", margin + 18, y - 68, 10, [0.400, 0.440, 0.520]);
      y -= height + 16;
      return;
    }
    const chartX = margin + 38;
    const chartY = y - 128;
    const chartW = cardWidth - 76;
    const chartH = 70;
    const maxValue = Math.max(...entries.map(([, value]) => Number(value) || 0), 1);
    line(chartX, chartY, chartX + chartW, chartY, [0.820, 0.830, 0.850], 1);
    line(chartX, chartY, chartX, chartY + chartH, [0.820, 0.830, 0.850], 1);
    const points = entries.map(([, value], index) => {
      const x = chartX + (chartW / (entries.length - 1)) * index;
      const v = Number(value) || 0;
      const pointY = chartY + (v / maxValue) * chartH;
      return { x, y: pointY, value: v };
    });
    setStroke(0.067, 0.078, 0.067);
    commands.push(`2 w ${points.map((point, index) => `${index ? "L" : "M"}`)}`);
    commands.pop();
    commands.push(`2 w ${points.map((point, index) => `${point.x} ${point.y} ${index ? "l" : "m"}`).join(" ")} S`);
    points.forEach((point, index) => {
      rect(point.x - 3, point.y - 3, 6, 6, [0.780, 0.635, 0.227]);
      text(String(point.value), point.x - 5, point.y + 10, 7);
      text(entries[index][0].slice(5), point.x - 8, chartY - 16, 7, [0.400, 0.440, 0.520]);
    });
    y -= height + 16;
  };

  drawHeader();
  drawMetrics();
  drawSourcesChart();
  drawBarChart("Top Compliments", "+", sections.topCompliments, "Not Enough Compliment Data Available Yet");
  drawComplaintBreakdown();
  drawTrendChart();
  drawSection("Summary", "S", [overview.summary ?? report.previewBody ?? "Not enough review data available yet."]);
  drawSection("Positive Themes", "+", themeLines(sections.positiveThemes, "No repeated positive themes yet."));
  drawSection("Negative Themes", "-", themeLines(sections.negativeThemes, "No repeated negative themes yet."));
  drawSection("Suggested Action Items", "A", sections.actionItems?.length ? sections.actionItems : ["No action items available yet."]);
  drawSection("Trend Summary", "T", [sections.trendSummary ?? "Not enough historical data available for trend analysis yet."]);
  finishPage();

  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    `2 0 obj << /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >> endobj`,
  ];
  pages.forEach((stream, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(`${pageObjectId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> /Contents ${contentObjectId} 0 R >> endobj`);
    objects.push(`${contentObjectId} 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`);
  });
  objects.push(`${3 + pages.length * 2} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf);
}

export async function getReportEmailPreference({ userId, businessProfileId }) {
  return prisma.reportEmailPreference.findUnique({
    where: {
      userId_businessProfileId: {
        userId,
        businessProfileId,
      },
    },
  });
}

export async function saveReportEmailPreference({ userId, businessProfileId, frequency, destinationEmail, enabled = true }) {
  return prisma.reportEmailPreference.upsert({
    where: {
      userId_businessProfileId: {
        userId,
        businessProfileId,
      },
    },
    update: {
      frequency,
      destinationEmail,
      enabled,
    },
    create: {
      userId,
      businessProfileId,
      frequency,
      destinationEmail,
      enabled,
    },
  });
}

export async function disableReportEmailPreference({ userId, businessProfileId }) {
  const preference = await getReportEmailPreference({ userId, businessProfileId });

  if (!preference) return null;

  return prisma.reportEmailPreference.update({
    where: { id: preference.id },
    data: { enabled: false },
  });
}
