import express from 'express';
import expressAsyncHandler from 'express-async-handler';
import Order from '../models/orderModel.js';
import User from '../models/userModel.js';
import Product from '../models/productModel.js';
import { isAuth, isAdmin, payOrderEmailTemplate } from '../utils.js';
import nodemailer from 'nodemailer';
import moment from 'moment'; // Pour manipuler les dates facilement

const orderRouter = express.Router();

// Créer un objet Nodemailer pour l'envoi d'emails
const transporter = nodemailer.createTransport({
  service: 'gmail', // Utilisez d'autres services comme SendGrid, Outlook, etc.
  auth: {
    user: 'ecoartteampi@gmail.com', // Remplacez par votre adresse e-mail
    pass: 'zwsb opga qbas fwnl', // Utilisez un mot de passe d'application si vous utilisez la vérification en deux étapes Gmail
  },
});

// Fonction pour envoyer un e-mail avec Nodemailer
const sendEmail = async (order) => {
  const mailOptions = {
    from: 'INFOSHP TUNISIA <eshop@example.com>', // Adresse de l'expéditeur
    to: `${order.user.name} <${order.user.email}>`, // Adresse du destinataire
    subject: `New Order ${order._id}`, // Sujet de l'email
    html: payOrderEmailTemplate(order), // Contenu HTML de l'email (votre template)
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

// Route pour créer une nouvelle commande
orderRouter.post(
  '/',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const {
      orderItems,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      shippingPrice,
      taxPrice,
      totalPrice,
    } = req.body;

    // Vérification de la disponibilité des produits dans le stock
    for (const item of orderItems) {
      const product = await Product.findById(item._id);
      if (product.countInStock < item.quantity) {
        return res.status(400).send({ message: `Sorry, ${product.name} is out of stock` });
      }
    }

    // Calcul de la date de paiement (actuellement)
    const paymentDate = moment().format('YYYY-MM-DD HH:mm:ss'); // Format de la date de paiement
    
    // Calcul de la date de livraison (J+1 à 09:45)
    const deliveryDate = moment().add(1, 'days').set({ hour: 9, minute: 45 }).format('YYYY-MM-DD HH:mm:ss'); // J+1 à 09:45

    // Créer une nouvelle commande avec les informations fournies
    const newOrder = new Order({
      orderItems: orderItems.map((x) => ({ ...x, product: x._id })),
      shippingAddress,
      paymentMethod: paymentMethod || 'Cash on Delivery', // Méthode de paiement par défaut
      itemsPrice,
      shippingPrice,
      taxPrice,
      totalPrice,
      user: req.user._id,
      isPaid: true, // Marquer la commande comme payée
      paidAt: Date.now(), // Ajouter la date de paiement
      paymentDate, // Date de paiement
      deliveryDate, // Date de livraison à J+1 à 09:45
      isDelivered: true, // Marquer la commande comme non livrée
      deliveredAt: null, // La date de livraison sera mise à jour une fois la commande livrée
    });

    // Sauvegarder la commande dans la base de données
    const order = await newOrder.save();

    // Mettre à jour le stock des produits après la commande
    const updateProductStock = async (orderItems) => {
      for (const item of orderItems) {
        const product = await Product.findById(item._id);
        if (product.countInStock >= item.quantity) {
          product.countInStock -= item.quantity; // Décrémenter le stock de chaque produit
          await product.save();
        }
      }
    };

    // Appel de la fonction pour mettre à jour le stock
    await updateProductStock(orderItems);

    // Envoyer un email de confirmation via Nodemailer
    await sendEmail(order);

    res.status(201).send({ message: 'New Order Created', order });
  })
);

// Route pour marquer une commande comme payée
orderRouter.put(
  '/:id/pay',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id).populate('user', 'email name');
    if (order) {
      order.isPaid = true;
      order.paidAt = new Date();
      order.paymentResult = {
        id: req.body.id,
        status: req.body.status,
        update_time: req.body.update_time,
        email_address: req.body.email_address,
      };

      const updatedOrder = await order.save();

      // Envoyer l'email après le paiement via Nodemailer
      await sendEmail(order);

      res.send({ message: 'Order Paid', order: updatedOrder });
    } else {
      res.status(404).send({ message: 'Order Not Found' });
    }
  })
);

// Route pour récupérer toutes les commandes (admin seulement)
orderRouter.get(
  '/',
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const orders = await Order.find().populate('user', 'name');
    res.send(orders);
  })
);

// Route pour marquer une commande comme livrée
orderRouter.put(
  '/:id/deliver',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (order) {
      order.isDelivered = true;
      order.deliveredAt = new Date()+1;
      await order.save();
      res.send({ message: 'Order Delivered' });
    } else {
      res.status(404).send({ message: 'Order Not Found' });
    }
  })
);

// Route pour supprimer une commande (admin seulement)
orderRouter.delete(
  '/:id',
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (order) {
      await order.remove();
      res.send({ message: 'Order Deleted' });
    } else {
      res.status(404).send({ message: 'Order Not Found' });
    }
  })
);

// Route pour obtenir un résumé des commandes (admin seulement)
orderRouter.get(
  '/summary',
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const orders = await Order.aggregate([
      {
        $group: {
          _id: null,
          numOrders: { $sum: 1 },
          totalSales: { $sum: '$totalPrice' },
        },
      },
    ]);
    const users = await User.aggregate([
      {
        $group: {
          _id: null,
          numUsers: { $sum: 1 },
        },
      },
    ]);
    const dailyOrders = await Order.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          orders: { $sum: 1 },
          sales: { $sum: '$totalPrice' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const productCategories = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
        },
      },
    ]);
    res.send({ users, orders, dailyOrders, productCategories });
  })
);

// Route pour récupérer les commandes d'un utilisateur
orderRouter.get(
  '/mine',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const orders = await Order.find({ user: req.user._id });
    res.send(orders);
  })
);

// Route pour récupérer une commande par son ID
orderRouter.get(
  '/:id',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (order) {
      res.send(order);
    } else {
      res.status(404).send({ message: 'Order Not Found' });
    }
  })
);

export default orderRouter;
