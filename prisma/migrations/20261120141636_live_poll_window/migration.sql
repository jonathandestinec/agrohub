-- CreateTable
-- UNLOGGED: written on every poll; a crash only resets the counts.
CREATE UNLOGGED TABLE "live_poll_window" (
    "userId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "live_poll_window_pkey" PRIMARY KEY ("userId")
);
