import mongoose from "mongoose";
import Invoice from "./models/Invoice.js";

export async function connectDatabase() {
  // Strip MongoDB operators (e.g. $gt, $where) from all query filter objects.
  // This prevents NoSQL injection: if a user sends { "email": { "$gt": "" } }
  // Mongoose will ignore the $ key instead of using it as an operator.
  mongoose.set("sanitizeFilter", true);

  const mongoURI = process.env.MONGODB_URI;

  if (!mongoURI) {
    throw new Error("MONGODB_URI is missing from the .env file");
  }

  // serverSelectionTimeoutMS: how long Mongoose waits to find a usable
  // MongoDB server before throwing a MongoServerSelectionError.
  await mongoose.connect(mongoURI, {
    serverSelectionTimeoutMS: 10000,
  });

  // Ensure collection indexes match schema (replaces outdated non-sparse indexes)
  await Invoice.syncIndexes();

  console.log("MongoDB connected successfully!");
}