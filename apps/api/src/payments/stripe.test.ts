import "dotenv/config";
import Stripe from "stripe";

async function main() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

  const intent = await stripe.paymentIntents.create({
    amount: 500, // 5€
    currency: "eur",
    payment_method_types: ["card"],
  });

  console.log("Created intent:", intent.id, intent.client_secret);
}

main().catch(console.error);
