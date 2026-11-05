import React, { useEffect, useRef, useState } from "react";
import type { ConfirmationResult } from "firebase/auth";
import {
  ArrowLeft,
  BadgeCheck,
  Car,
  IndianRupee,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  createRecaptchaVerifier,
  sendOtpToPhone,
  confirmOtpCode,
  describePhoneAuthError,
} from "../services/authService";

export type AuthIntent = "login" | "signup";

interface AuthScreenProps {
  /**
   * Called just before the OTP is confirmed so the app knows whether an
   * unknown number should be sent to signup or told "no account found".
   */
  onIntent: (intent: AuthIntent) => void;
}

const RESEND_SECONDS = 30;

export const AuthScreen: React.FC<AuthScreenProps> = ({ onIntent }) => {
  const [mode, setMode] = useState<AuthIntent | null>(null);
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [mobileNumber, setMobileNumber] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [sendError, setSendError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(
    null,
  );
  const [resendIn, setResendIn] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.location.hostname === "127.0.0.1"
    ) {
      window.location.hostname = "localhost";
    }
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const resetToPhone = () => {
    setStep("phone");
    setOtp(["", "", "", "", "", ""]);
    setOtpError("");
    setConfirmation(null);
  };

  const handleOtpChange = (index: number, val: string) => {
    let digits = val.replace(/\D/g, "");
    // Typing over a filled box yields two chars — keep the new one.
    if (digits.length === 2 && otp[index])
      digits = digits.replace(otp[index], "") || digits.slice(-1);
    if (digits.length > 1) {
      const next = [...otp];
      for (let i = 0; i < 6; i++) next[i] = digits[i] || "";
      setOtp(next);
      otpRefs.current[Math.min(digits.length, 5)]?.focus();
      return;
    }
    const next = [...otp];
    next[index] = digits;
    setOtp(next);
    if (digits && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace" && !otp[index] && index > 0)
      otpRefs.current[index - 1]?.focus();
    if (e.key === "Enter") handleVerifyOtp();
  };

  const handleSendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
      setSendError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    setSendError("");
    setOtpError("");
    setIsSending(true);
    try {
      const verifier = createRecaptchaVerifier("driver-recaptcha-container");
      const result = await sendOtpToPhone(`+91${mobileNumber}`, verifier);
      setConfirmation(result);
      setOtp(["", "", "", "", "", ""]);
      setStep("otp");
      setResendIn(RESEND_SECONDS);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (error) {
      const msg = describePhoneAuthError(error);
      if (step === "otp") setOtpError(msg);
      else setSendError(msg);
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    const entered = otp.join("");
    if (entered.length < 6) {
      setOtpError("Please enter the 6-digit OTP.");
      return;
    }
    if (!confirmation) {
      setOtpError("Session expired. Please request a new OTP.");
      return;
    }
    setOtpError("");
    setIsVerifying(true);
    try {
      onIntent(mode ?? "login");
      // The app's auth listener takes over from here (login → profile,
      // signup → registration wizard).
      await confirmOtpCode(confirmation, entered);
    } catch (error) {
      setOtpError(describePhoneAuthError(error));
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F7F7] text-gray-900 flex flex-col items-center justify-center p-4 sm:p-6">
      <div id="driver-recaptcha-container" />

      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-6 sm:p-8">
        {/* Welcome: choose Login or Sign Up */}
        {mode === null && (
          <div className="space-y-6">
            <div className="text-center">
              <img
                src="/icons/logo.png"
                alt="NESAM Driver Partner"
                className="w-16 h-16 rounded-2xl object-contain bg-gray-50 border border-gray-200 p-1.5 mx-auto mb-4"
              />
              <h1 className="text-2xl font-black text-gray-900">
                NESAM Driver Partner
              </h1>
              <p className="text-xs text-gray-500 mt-1">
                Drive with NESAM Tours &amp; Travels. Earn on every trip.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { icon: Car, text: "Outstation & city trips" },
                { icon: IndianRupee, text: "Weekly payouts" },
                { icon: ShieldCheck, text: "Verified customers" },
              ].map(({ icon: Icon, text }) => (
                <div
                  key={text}
                  className="bg-gray-50 border border-gray-200 rounded-xl p-3"
                >
                  <Icon className="w-5 h-5 text-[#E21E26] mx-auto mb-1" />
                  <span className="text-[10px] font-semibold text-gray-600 leading-tight block">
                    {text}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setMode("login")}
                className="w-full bg-[#E21E26] text-white py-3.5 rounded-2xl font-black text-sm hover:bg-[#C9141B] transition-colors shadow-sm"
              >
                Login
              </button>
              <button
                onClick={() => setMode("signup")}
                className="w-full bg-white text-gray-900 border-2 border-gray-900 py-3 rounded-2xl font-black text-sm hover:bg-gray-50 transition-colors"
              >
                Sign Up as New Driver
              </button>
            </div>
          </div>
        )}

        {/* Phone number */}
        {mode !== null && step === "phone" && (
          <div className="space-y-6">
            <div>
              <button
                onClick={() => {
                  setMode(null);
                  setSendError("");
                }}
                className="text-xs text-gray-400 hover:text-gray-700 mb-4 flex items-center gap-1 font-bold"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
              <h2 className="text-xl font-black text-gray-900 mb-1">
                {mode === "login" ? "Driver Login" : "Create Driver Account"}
              </h2>
              <p className="text-xs text-gray-500">
                {mode === "login"
                  ? "Enter your registered mobile number. We will send you an OTP."
                  : "Step 1 of registration — verify your mobile number with an OTP."}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                  Mobile Number
                </label>
                <div className="flex items-center bg-gray-50 border border-gray-300 rounded-2xl px-4 py-3 focus-within:border-[#E21E26] focus-within:bg-white transition-colors">
                  <span className="text-sm font-bold text-[#E21E26] mr-3">
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="98765 43210"
                    maxLength={10}
                    value={mobileNumber}
                    autoFocus
                    onChange={(e) =>
                      setMobileNumber(e.target.value.replace(/\D/g, ""))
                    }
                    onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                    className="bg-transparent w-full text-sm font-bold text-gray-900 focus:outline-none placeholder-gray-400"
                  />
                </div>
              </div>

              {sendError && (
                <div className="text-[11px] text-[#D92D20] text-center font-semibold">
                  {sendError}
                </div>
              )}

              <button
                onClick={handleSendOtp}
                disabled={isSending}
                className="w-full bg-[#E21E26] text-white py-3.5 rounded-2xl font-black text-sm hover:bg-[#C9141B] transition-colors shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isSending && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSending ? "Sending OTP..." : "Send OTP"}
              </button>

              <p className="text-[11px] text-gray-500 text-center">
                {mode === "login" ? "New to NESAM? " : "Already registered? "}
                <button
                  onClick={() => setMode(mode === "login" ? "signup" : "login")}
                  className="text-[#E21E26] font-bold hover:underline"
                >
                  {mode === "login" ? "Sign up" : "Login"}
                </button>
              </p>
            </div>
          </div>
        )}

        {/* OTP */}
        {mode !== null && step === "otp" && (
          <div className="space-y-6">
            <div>
              <button
                onClick={resetToPhone}
                className="text-xs text-gray-400 hover:text-gray-700 mb-4 flex items-center gap-1 font-bold"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Change Number
              </button>
              <h2 className="text-xl font-black text-gray-900 mb-1">
                Verify Your Number
              </h2>
              <p className="text-xs text-gray-500">
                Enter the 6-digit OTP sent to{" "}
                <span className="text-gray-900 font-bold">
                  +91 {mobileNumber}
                </span>
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between gap-2">
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      otpRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={idx === 0 ? "one-time-code" : "off"}
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className={`w-full aspect-square text-center bg-gray-50 border ${
                      otpError ? "border-red-500" : "border-gray-300"
                    } rounded-xl text-lg font-black text-gray-900 focus:border-[#E21E26] focus:bg-white focus:outline-none transition-colors`}
                  />
                ))}
              </div>

              {otpError && (
                <div className="text-[11px] text-[#D92D20] text-center font-semibold">
                  {otpError}
                </div>
              )}

              <button
                onClick={handleVerifyOtp}
                disabled={isVerifying}
                className="w-full bg-[#E21E26] text-white py-3.5 rounded-2xl font-black text-sm hover:bg-[#C9141B] transition-colors shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isVerifying && <Loader2 className="w-4 h-4 animate-spin" />}
                {isVerifying
                  ? "Verifying..."
                  : mode === "login"
                    ? "Verify & Login"
                    : "Verify & Continue"}
              </button>

              <div className="flex justify-between items-center text-xs text-gray-400 px-1">
                <span className="flex items-center gap-1">
                  <BadgeCheck className="w-3.5 h-3.5 text-emerald-500" />{" "}
                  Secured by Firebase
                </span>
                {resendIn > 0 ? (
                  <span>Resend in {resendIn}s</span>
                ) : (
                  <button
                    onClick={handleSendOtp}
                    disabled={isSending}
                    className="text-[#E21E26] font-bold hover:underline disabled:opacity-60"
                  >
                    {isSending ? "Sending..." : "Resend OTP"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 mt-6 text-center">
        NESAM Tours &amp; Travels • Driver Partner Portal
      </p>
    </div>
  );
};
