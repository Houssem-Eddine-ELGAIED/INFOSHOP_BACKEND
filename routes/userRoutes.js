import express from 'express';
import bcrypt from 'bcryptjs';
import expressAsyncHandler from 'express-async-handler';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import { generateToken, isAuth, isAdmin } from '../utils.js';

const userRouter = express.Router();

// Route for user sign-in
userRouter.post(
  '/signin',
  expressAsyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user) {
      if (bcrypt.compareSync(req.body.password, user.password)) {
        res.send({
          _id: user._id,
          name: user.name,
          email: user.email,
          isAdmin: user.isAdmin,
          token: generateToken(user),
        });
        return;
      }
    }
    res.status(401).send({ message: 'Invalid email or password' });
  })
);

// Route for forgot password
userRouter.post(
  '/forgotpassword',
  expressAsyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    // Create a password reset token
    const resetToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Send the reset password email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      port: 587,
  secure: false, // use TLS
  auth: {
    user: 'ecoartteampi@gmail.com',
    pass: 'zwsb opga qbas fwnl'
  }
      },
    )

    const resetUrl = `${process.env.BASE_URL}/resetpassword/${resetToken}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Password Reset Request',
      text: `You requested a password reset. Please click on the following link to reset your password: ${resetUrl}`,
    };

    try {
      await transporter.sendMail(mailOptions);
      res.send({ message: 'Password reset email sent' });
    } catch (error) {
      res.status(500).send({ message: 'Error sending email' });
    }
  })
);

// Route for resetting the password
userRouter.post(
  '/resetpassword/:token',
  expressAsyncHandler(async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;

    // Verify the token
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(404).send({ message: 'User not found' });
      }

      // Hash the new password
      user.password = bcrypt.hashSync(password, 8);

      // Save the updated user
      await user.save();
      res.send({ message: 'Password has been reset successfully' });
    } catch (error) {
      res.status(400).send({ message: 'Invalid or expired token' });
    }
  })
);

// Other routes ...

export default userRouter;
