declare module 'razorpay' {
  interface RazorpayOrder {
    id: string;
    amount: number | string;
    currency: string;
    receipt?: string;
    status: string;
  }

  interface RazorpayOrderCreateOptions {
    amount: number;
    currency: string;
    receipt?: string;
    notes?: Record<string, string>;
  }

  class Razorpay {
    constructor(options: { key_id: string; key_secret: string });
    orders: {
      create(options: RazorpayOrderCreateOptions): Promise<RazorpayOrder>;
    };
  }

  export = Razorpay;
}
