import mongoose from "mongoose";
import bcrypt from "bcrypt";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters."],
    },
    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please enter a valid email address."],
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required."],
    },
    businessName: {
      type: String,
      trim: true,
      maxlength: [200, "Business name cannot exceed 200 characters."],
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Compare plain candidate password with stored bcrypt hash
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword || !this.passwordHash) return false;
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

/**
 * Hash a plain password with 12 salt rounds
 */
userSchema.statics.hashPassword = async function (plainPassword) {
  return bcrypt.hash(plainPassword, 12);
};

const User = mongoose.model("User", userSchema);

export default User;
