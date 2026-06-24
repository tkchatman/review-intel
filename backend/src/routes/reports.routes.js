import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePremium } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  disableReportEmailPreference,
  generateReport,
  getBusinessProfileForUser,
  getReportEmailPreference,
  getReportForUser,
  listReports,
  reportToPdfBuffer,
  saveReportEmailPreference,
} from "../services/reports.service.js";
import { prisma } from "../lib/prisma.js";

export const reportsRouter = Router();

function serializeReport(report) {
  return {
    id: report.id,
    userId: report.userId,
    businessProfileId: report.businessProfileId,
    businessName: report.businessProfile?.displayName,
    analysisResultId: report.analysisResultId,
    cadence: report.cadence,
    status: report.status,
    title: report.title,
    subject: report.subject,
    previewBody: report.previewBody,
    dateRangeStart: report.dateRangeStart,
    dateRangeEnd: report.dateRangeEnd,
    generatedAt: report.generatedAt,
    createdAt: report.createdAt,
    emailStatus: report.emailStatus,
    recipientEmail: report.recipientEmail,
    rawPayload: report.rawPayload,
  };
}

function reportPdfFilename(report) {
  const businessName = report.businessProfile?.displayName ?? "Review Intel Care";
  const safeBusinessName = businessName.replace(/[\\/:*?"<>|]/g, "").trim() || "Review Intel Care";
  return `${safeBusinessName}-${report.cadence.toLowerCase()}-report.pdf`;
}

async function requireOwnedBusinessProfile(userId, businessProfileId) {
  const businessProfile = await getBusinessProfileForUser({ userId, businessProfileId });

  if (!businessProfile) {
    const error = new Error("Selected business was not found for this account.");
    error.statusCode = 404;
    throw error;
  }

  return businessProfile;
}

reportsRouter.get(
  "/",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        businessProfileId: z.string().min(1).optional(),
      })
      .parse(req.query);
    const reports = await listReports({
      userId: req.user.id,
      businessProfileId: query.businessProfileId,
    });

    res.json({ reports: reports.map(serializeReport) });
  }),
);

reportsRouter.post(
  "/",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        businessProfileId: z.string().min(1),
        cadence: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
      })
      .parse(req.body);
    const report = await generateReport({
      userId: req.user.id,
      businessProfileId: body.businessProfileId,
      cadence: body.cadence,
    });

    res.status(201).json({ report: serializeReport(report) });
  }),
);

reportsRouter.get(
  "/:reportId",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const params = z.object({ reportId: z.string().min(1) }).parse(req.params);
    const report = await getReportForUser({
      userId: req.user.id,
      reportId: params.reportId,
    });

    if (!report) {
      return res.status(404).json({ error: { message: "Report not found." } });
    }

    res.json({ report: serializeReport(report) });
  }),
);

reportsRouter.get(
  "/:reportId/export/pdf",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const params = z.object({ reportId: z.string().min(1) }).parse(req.params);
    const report = await getReportForUser({ userId: req.user.id, reportId: params.reportId });

    if (!report) {
      return res.status(404).json({ error: { message: "Report not found." } });
    }

    const pdf = reportToPdfBuffer(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${reportPdfFilename(report)}"`);
    res.send(pdf);
  }),
);

reportsRouter.post(
  "/:reportId/email",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const params = z.object({ reportId: z.string().min(1) }).parse(req.params);
    const body = z.object({ destinationEmail: z.string().email() }).parse(req.body);
    const report = await getReportForUser({ userId: req.user.id, reportId: params.reportId });

    if (!report) {
      return res.status(404).json({ error: { message: "Report not found." } });
    }

    const updatedReport = await prisma.report.update({
      where: { id: report.id },
      data: {
        recipientEmail: body.destinationEmail,
        emailStatus: "QUEUED_NOT_CONFIGURED",
      },
    });

    res.json({
      report: serializeReport({ ...updatedReport, businessProfile: report.businessProfile }),
      message: "Email delivery is not configured yet. Your report export request was saved.",
      status: "not_configured",
      emailConfigured: false,
    });
  }),
);

reportsRouter.get(
  "/preferences/email",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const query = z.object({ businessProfileId: z.string().min(1) }).parse(req.query);
    await requireOwnedBusinessProfile(req.user.id, query.businessProfileId);
    const preference = await getReportEmailPreference({
      userId: req.user.id,
      businessProfileId: query.businessProfileId,
    });

    res.json({ preference });
  }),
);

reportsRouter.put(
  "/preferences/email",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        businessProfileId: z.string().min(1),
        frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
        destinationEmail: z.string().email(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body);
    await requireOwnedBusinessProfile(req.user.id, body.businessProfileId);
    const preference = await saveReportEmailPreference({
      userId: req.user.id,
      businessProfileId: body.businessProfileId,
      frequency: body.frequency,
      destinationEmail: body.destinationEmail,
      enabled: body.enabled ?? true,
    });

    res.json({ preference });
  }),
);

reportsRouter.delete(
  "/preferences/email",
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const body = z.object({ businessProfileId: z.string().min(1) }).parse(req.body);
    await requireOwnedBusinessProfile(req.user.id, body.businessProfileId);
    const preference = await disableReportEmailPreference({
      userId: req.user.id,
      businessProfileId: body.businessProfileId,
    });

    res.json({ preference, disabled: true });
  }),
);
