-- AlterTable
ALTER TABLE "ships" DROP COLUMN "rate",
DROP COLUMN "rateCurrency";

-- AlterTable
ALTER TABLE "truck_requirements" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "rateCurrency" TEXT;
