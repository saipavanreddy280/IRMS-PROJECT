const express = require("express");
const Notification = require("../models/Notification.cjs");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(notifications);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/read", async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { $set: { readAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    return res.json(notification);
  } catch (error) {
    return next(error);
  }
});

router.patch("/read-all", async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    return res.json({ message: "Notifications marked as read" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
