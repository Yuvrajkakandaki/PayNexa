import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: [true, "Webhook event ID is required."],
      unique: true,
      trim: true,
      index: true,
    },
    eventType: {
      type: String,
      required: [true, "Event type is required."],
      trim: true,
    },
    resourceId: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      trim: true,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

const WebhookEvent = mongoose.model("WebhookEvent", webhookEventSchema);

export default WebhookEvent;
