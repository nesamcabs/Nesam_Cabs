import React, { useState, useEffect, useMemo } from "react";
import {
  CustomerReview,
  ModerationStatus,
  FlagReason,
  Booking,
  Driver,
  Customer,
} from "../types";
import {
  subscribeReviews,
  subscribeBookings,
  subscribeDrivers,
  subscribeCustomers,
  updateFirestoreDocument,
} from "../services/adminFirestoreService";

export default function Reviews() {
  const [reviews, setReviews] = useState<CustomerReview[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [ratingFilter, setRatingFilter] = useState<string>("All");
  const [sortBy, setSortBy] = useState<
    "newest" | "oldest" | "highest" | "lowest"
  >("newest");

  // Selection & Modal States
  const [selectedReview, setSelectedReview] = useState<CustomerReview | null>(
    null,
  );
  const [showDetailDrawer, setShowDetailDrawer] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showAddPresetModal, setShowAddPresetModal] = useState(false);

  // Admin Response State inside Drawer
  const [responseText, setResponseText] = useState("");
  const [flagReason, setFlagReason] = useState<FlagReason>("Spam");
  const [internalNotes, setInternalNotes] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Load real-time Firestore subscriptions
  useEffect(() => {
    setLoading(true);
    const unsubReviews = subscribeReviews((data) => {
      setReviews(data || []);
      setLoading(false);
    });
    const unsubBookings = subscribeBookings((data) => setBookings(data || []));
    const unsubDrivers = subscribeDrivers((data) => setDrivers(data || []));
    const unsubCustomers = subscribeCustomers((data) =>
      setCustomers(data || []),
    );

    return () => {
      unsubReviews();
      unsubBookings();
      unsubDrivers();
      unsubCustomers();
    };
  }, []);

  // Show auto-dissolving toast
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const displayReviews = reviews;

  // Metrics derived from stored reviews
  const metrics = useMemo(() => {
    const total = displayReviews.length;
    const published = displayReviews.filter((r) => r.status === "Published");
    const pending = displayReviews.filter((r) => r.status === "Pending").length;
    const flagged = displayReviews.filter((r) => r.status === "Flagged").length;

    const sumRating = published.reduce(
      (sum, r) => sum + (r.overallRating || 0),
      0,
    );
    const avgRating =
      published.length > 0 ? (sumRating / published.length).toFixed(1) : "0.0";

    return {
      total,
      publishedCount: published.length,
      pending,
      flagged,
      avgRating,
    };
  }, [displayReviews]);

  // Filtered & Sorted Reviews
  const filteredReviews = useMemo(() => {
    return displayReviews
      .filter((rev) => {
        // Status filter
        if (statusFilter !== "All" && rev.status !== statusFilter) return false;

        // Rating filter
        if (ratingFilter !== "All") {
          const stars = parseInt(ratingFilter, 10);
          if (rev.overallRating !== stars) return false;
        }

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchCustomer = rev.customerName?.toLowerCase().includes(q);
          const matchBooking = rev.bookingId?.toLowerCase().includes(q);
          const matchDriver = rev.driverName?.toLowerCase().includes(q);
          const matchText = rev.reviewText?.toLowerCase().includes(q);
          const matchService = rev.serviceName?.toLowerCase().includes(q);

          if (
            !matchCustomer &&
            !matchBooking &&
            !matchDriver &&
            !matchText &&
            !matchService
          ) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const dateA = a.createdAt?.toDate
          ? a.createdAt.toDate().getTime()
          : new Date(a.createdAt || 0).getTime();
        const dateB = b.createdAt?.toDate
          ? b.createdAt.toDate().getTime()
          : new Date(b.createdAt || 0).getTime();

        if (sortBy === "newest") return dateB - dateA;
        if (sortBy === "oldest") return dateA - dateB;
        if (sortBy === "highest") return b.overallRating - a.overallRating;
        if (sortBy === "lowest") return a.overallRating - b.overallRating;
        return 0;
      });
  }, [reviews, statusFilter, ratingFilter, searchQuery, sortBy]);

  // Open moderation drawer
  const handleOpenDetail = (rev: CustomerReview) => {
    setSelectedReview(rev);
    setResponseText(rev.adminResponse?.text || "");
    setFlagReason((rev.moderation?.reason as FlagReason) || "Spam");
    setInternalNotes(rev.moderation?.internalNotes || "");
    setShowDetailDrawer(true);
  };

  // Perform status change moderation action
  const handleUpdateStatus = async (
    reviewId: string,
    newStatus: ModerationStatus,
    reason?: string,
  ) => {
    const patchData: any = {
      status: newStatus,
      "moderation.moderatedAt": new Date().toISOString(),
      "moderation.moderatedBy": "Admin",
    };

    if (reason) {
      patchData["moderation.reason"] = reason;
      patchData["moderation.flagged"] = newStatus === "Flagged";
    }

    if (internalNotes) {
      patchData["moderation.internalNotes"] = internalNotes;
    }

    const ok = await updateFirestoreDocument("reviews", reviewId, patchData);
    if (!ok) { triggerToast("Review was not saved. Check your access and connection, then try again."); return; }
    setReviews((prev) =>
      prev.map((r) => (r.id === reviewId ? { ...r, ...patchData } : r)),
    );
    triggerToast(`Review status updated to ${newStatus}`);
    if (selectedReview?.id === reviewId) {
      setSelectedReview((prev) =>
        prev ? { ...prev, status: newStatus } : null,
      );
    }
  };

  // Save official Admin Response
  const handleSaveResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReview) return;
    if (!responseText.trim()) {
      triggerToast("Please enter response text before posting");
      return;
    }

    const adminResponseData = {
      text: responseText.trim(),
      respondedBy: "Nesam Support Admin",
      respondedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ok = await updateFirestoreDocument("reviews", selectedReview.id, {
      adminResponse: adminResponseData,
    });
    if (!ok) { triggerToast("Response was not saved. Check your access and connection, then try again."); return; }

    setReviews((prev) =>
      prev.map((r) =>
        r.id === selectedReview.id
          ? { ...r, adminResponse: adminResponseData }
          : r,
      ),
    );
    triggerToast("Official Admin Response published successfully!");
    setSelectedReview((prev) =>
      prev ? { ...prev, adminResponse: adminResponseData } : null,
    );
  };

  // Helper for status badge styling
  const getStatusBadge = (status: ModerationStatus) => {
    switch (status) {
      case "Published":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 border border-green-200">
            Published
          </span>
        );
      case "Pending":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200">
            Pending Review
          </span>
        );
      case "Flagged":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 border border-red-200">
            Flagged
          </span>
        );
      case "Hidden":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700 border border-gray-300">
            Hidden
          </span>
        );
      case "Archived":
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 border border-purple-200">
            Archived
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
            {status}
          </span>
        );
    }
  };

  // Helper for star rating UI
  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5 text-amber-400">
        {[1, 2, 3, 4, 5].map((star) => (
          <svg
            key={star}
            className={`w-4 h-4 ${star <= rating ? "fill-current" : "text-gray-300 fill-current"}`}
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-500 font-medium text-sm">
            Loading Reviews & Ratings Data...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl text-sm flex items-center gap-2 border border-gray-700 animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-green-400"></span>
          {toastMessage}
        </div>
      )}

      {/* Header & Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <nav className="text-xs text-gray-500 mb-1 flex items-center gap-1.5">
            <span>Nesam Admin</span>
            <span>/</span>
            <span>System</span>
            <span>/</span>
            <span className="font-semibold text-gray-800">Reviews</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">
            Reviews & Ratings
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Moderate verified customer reviews, monitor driver ratings, flag
            abuse, and publish official responses.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowConfigModal(true)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 shadow-sm flex items-center gap-2"
          >
            <svg
              className="w-4 h-4 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Review Settings
          </button>
        </div>
      </div>

      {/* Summary Dashboard Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Reviews */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Total Reviews
            </p>
            <h3 className="text-2xl font-bold text-gray-900 mt-1">
              {metrics.total}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {metrics.publishedCount} Published on Site
            </p>
          </div>
          <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
          </div>
        </div>

        {/* Card 2: Average Published Rating */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Average Rating
            </p>
            <div className="flex items-center gap-2 mt-1">
              <h3 className="text-2xl font-bold text-gray-900">
                {metrics.avgRating}
              </h3>
              <span className="text-sm font-semibold text-gray-500">/ 5.0</span>
            </div>
            <div className="mt-1">
              {renderStars(Math.round(parseFloat(metrics.avgRating)))}
            </div>
          </div>
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center">
            <svg className="w-6 h-6 fill-current" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </div>
        </div>

        {/* Card 3: Pending Moderation */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Pending Moderation
            </p>
            <h3 className="text-2xl font-bold text-yellow-700 mt-1">
              {metrics.pending}
            </h3>
            <p className="text-xs text-gray-500 mt-1">Requires Admin Action</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-yellow-50 text-yellow-600 flex items-center justify-center">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </div>

        {/* Card 4: Flagged Abuse */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Flagged Reviews
            </p>
            <h3 className="text-2xl font-bold text-red-700 mt-1">
              {metrics.flagged}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Abuse & Policy Warnings
            </p>
          </div>
          <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Main Reviews Management View */}
      {reviews.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center max-w-2xl mx-auto my-8 shadow-sm">
          <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Reviews & Ratings
          </h2>
          <p className="text-sm text-gray-600 mb-6 max-w-md mx-auto leading-relaxed">
            Moderate customer reviews and ratings for drivers and overall
            service quality. Flag abuse and respond to negative feedback.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Controls Bar: Search & Filters */}
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search by customer, booking ID, driver or review..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <svg
                className="w-4 h-4 text-gray-400 absolute left-3 top-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>

            {/* Filters & Sorting */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="All">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Published">Published</option>
                <option value="Flagged">Flagged</option>
                <option value="Hidden">Hidden</option>
              </select>

              {/* Star Rating Filter */}
              <select
                value={ratingFilter}
                onChange={(e) => setRatingFilter(e.target.value)}
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="All">All Ratings</option>
                <option value="5">5 Stars</option>
                <option value="4">4 Stars</option>
                <option value="3">3 Stars</option>
                <option value="2">2 Stars</option>
                <option value="1">1 Star</option>
              </select>

              {/* Sort By */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="highest">Highest Rating</option>
                <option value="lowest">Lowest Rating</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-100/70 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Booking & Service</th>
                  <th className="py-3 px-4">Driver</th>
                  <th className="py-3 px-4">Rating</th>
                  <th className="py-3 px-4">Review Content</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-sm text-gray-800">
                {filteredReviews.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-500">
                      <div className="text-sm font-medium mb-2">
                        {reviews.length === 0
                          ? "No customer reviews yet. Reviews appear here when customers rate completed trips."
                          : "No customer reviews match your search and filter criteria."}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredReviews.map((rev) => (
                    <tr
                      key={rev.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      {/* Customer */}
                      <td className="py-3.5 px-4 font-medium">
                        <div className="font-semibold text-gray-900">
                          {rev.customerName || "Anonymous Customer"}
                        </div>
                        <div className="text-xs text-gray-500">
                          {rev.customerPhone || rev.customerId}
                        </div>
                      </td>

                      {/* Booking & Service */}
                      <td className="py-3.5 px-4">
                        <div className="font-mono text-xs text-blue-600 font-semibold">
                          {rev.bookingId}
                        </div>
                        <div className="text-xs text-gray-600">
                          {rev.serviceName || "Taxi Ride"}
                        </div>
                      </td>

                      {/* Driver */}
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-gray-900">
                          {rev.driverName || "Unassigned"}
                        </div>
                        <div className="text-xs text-gray-500">
                          {rev.vehicleNumber || "Cab N/A"}
                        </div>
                      </td>

                      {/* Rating */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-gray-900">
                            {rev.overallRating}.0
                          </span>
                          {renderStars(rev.overallRating)}
                        </div>
                      </td>

                      {/* Review Content */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="text-xs text-gray-700 line-clamp-2">
                          {rev.reviewText ? (
                            `"${rev.reviewText}"`
                          ) : (
                            <span className="italic text-gray-400">
                              No written text provided
                            </span>
                          )}
                        </p>
                        {rev.adminResponse && (
                          <div className="mt-1 text-[11px] text-green-700 font-medium flex items-center gap-1">
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                              />
                            </svg>
                            Responded
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        {getStatusBadge(rev.status)}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenDetail(rev)}
                            className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                          >
                            Manage
                          </button>
                          {rev.status !== "Published" && (
                            <button
                              onClick={() =>
                                handleUpdateStatus(rev.id, "Published")
                              }
                              className="px-2.5 py-1.5 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-md transition-colors"
                              title="Publish Review"
                            >
                              Publish
                            </button>
                          )}
                          {rev.status !== "Hidden" && (
                            <button
                              onClick={() =>
                                handleUpdateStatus(rev.id, "Hidden")
                              }
                              className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                              title="Hide from public display"
                            >
                              Hide
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL / DRAWER: Review Detail & Moderation Composer */}
      {showDetailDrawer && selectedReview && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-white min-h-screen shadow-2xl flex flex-col justify-between animate-slide-left">
            {/* Drawer Header */}
            <div>
              <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-gray-900">
                      Review Moderation
                    </h2>
                    {getStatusBadge(selectedReview.status)}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Booking Ref:{" "}
                    <span className="font-mono font-semibold">
                      {selectedReview.bookingId}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => setShowDetailDrawer(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-200 transition-colors"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Drawer Content */}
              <div className="p-6 space-y-6">
                {/* Section 1: Customer Review Voice (READ ONLY) */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-gray-900 text-sm">
                        {selectedReview.customerName}
                      </h4>
                      <p className="text-xs text-gray-500">
                        {selectedReview.customerPhone ||
                          selectedReview.customerId}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 justify-end">
                        {renderStars(selectedReview.overallRating)}
                      </div>
                      <span className="text-xs font-bold text-gray-800">
                        {selectedReview.overallRating}.0 / 5.0 Rating
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Customer Voice (Authentic & Immutable)
                    </p>
                    <p className="text-sm text-gray-800 italic mt-1 bg-white p-3 rounded-lg border border-gray-200">
                      {selectedReview.reviewText
                        ? `"${selectedReview.reviewText}"`
                        : "No review message entered."}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 pt-2 border-t border-gray-200">
                    <div>
                      <span className="font-semibold">Driver:</span>{" "}
                      {selectedReview.driverName || "N/A"}
                    </div>
                    <div>
                      <span className="font-semibold">Vehicle:</span>{" "}
                      {selectedReview.vehicleNumber || "N/A"}
                    </div>
                    <div>
                      <span className="font-semibold">Service:</span>{" "}
                      {selectedReview.serviceName || "N/A"}
                    </div>
                    <div>
                      <span className="font-semibold">Date:</span>{" "}
                      {new Date(
                        selectedReview.createdAt || Date.now(),
                      ).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                {/* Section 2: Quick Moderation Actions */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Moderation Status Actions
                  </h4>
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={() =>
                        handleUpdateStatus(selectedReview.id, "Published")
                      }
                      className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all ${
                        selectedReview.status === "Published"
                          ? "bg-green-600 text-white border-green-600 shadow-xs"
                          : "bg-white text-green-700 border-green-300 hover:bg-green-50"
                      }`}
                    >
                      Publish
                    </button>
                    <button
                      onClick={() =>
                        handleUpdateStatus(selectedReview.id, "Hidden")
                      }
                      className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all ${
                        selectedReview.status === "Hidden"
                          ? "bg-gray-800 text-white border-gray-800 shadow-xs"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      Hide
                    </button>
                    <button
                      onClick={() =>
                        handleUpdateStatus(
                          selectedReview.id,
                          "Flagged",
                          flagReason,
                        )
                      }
                      className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all ${
                        selectedReview.status === "Flagged"
                          ? "bg-red-600 text-white border-red-600 shadow-xs"
                          : "bg-white text-red-700 border-red-300 hover:bg-red-50"
                      }`}
                    >
                      Flag Abuse
                    </button>
                    <button
                      onClick={() =>
                        handleUpdateStatus(selectedReview.id, "Pending")
                      }
                      className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all ${
                        selectedReview.status === "Pending"
                          ? "bg-yellow-600 text-white border-yellow-600 shadow-xs"
                          : "bg-white text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                      }`}
                    >
                      Pending
                    </button>
                  </div>
                </div>

                {/* Section 3: Flag Reason & Internal Notes */}
                <div className="space-y-3 bg-red-50/50 p-4 rounded-xl border border-red-100">
                  <h4 className="text-xs font-bold text-red-900 uppercase tracking-wider">
                    Abuse & Moderation Context
                  </h4>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Flag Reason (Internal Only)
                      </label>
                      <select
                        value={flagReason}
                        onChange={(e) =>
                          setFlagReason(e.target.value as FlagReason)
                        }
                        className="w-full px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium focus:ring-2 focus:ring-red-500"
                      >
                        <option value="Spam">Spam / Promotion</option>
                        <option value="Abusive Content">
                          Abusive / Profane Content
                        </option>
                        <option value="Irrelevant">Irrelevant to Trip</option>
                        <option value="Duplicate">Duplicate Review</option>
                        <option value="Privacy Concern">
                          Privacy Violation
                        </option>
                        <option value="Other">Other Operational Concern</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Internal Admin Notes
                      </label>
                      <textarea
                        rows={2}
                        value={internalNotes}
                        onChange={(e) => setInternalNotes(e.target.value)}
                        placeholder="Internal audit notes for customer support team..."
                        className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 4: Official Nesam Response Composer */}
                <form onSubmit={handleSaveResponse} className="space-y-3">
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center justify-between">
                    <span>Official Nesam Response</span>
                    {selectedReview.adminResponse && (
                      <span className="text-green-600 font-normal">
                        Active Response On Record
                      </span>
                    )}
                  </h4>
                  <textarea
                    rows={3}
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Type official response to customer (e.g. Thank you for your feedback! We appreciate your travel with Nesam Tours...)"
                    className="w-full p-3 bg-white border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-red-500"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-semibold text-white rounded-lg shadow-sm transition-all hover:opacity-95"
                      style={{ backgroundColor: "#c1232c" }}
                    >
                      Post Official Response
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                onClick={() => setShowDetailDrawer(false)}
                className="px-5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Review Settings */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-gray-200 pb-3">
              <h3 className="text-lg font-bold text-gray-900">
                Current Review Policy
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="space-y-4 text-xs text-gray-700">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  defaultChecked
                  disabled
                  className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                />
                <span className="font-medium">
                  Require Completed Booking status for reviews
                </span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  disabled
                  className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                />
                <span className="font-medium">
                  Automatic publication (not connected)
                </span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  disabled
                  className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                />
                <span className="font-medium">
                  Automatic low-rating alerts (not connected)
                </span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  defaultChecked
                  disabled
                  className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                />
                <span className="font-medium">
                  Store an official response with the review
                </span>
              </label>
            </div>

            <div className="flex justify-end pt-3 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowConfigModal(false);
                }}
                className="px-4 py-2 text-xs font-semibold text-white rounded-lg shadow-sm"
                style={{ backgroundColor: "#c1232c" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
