ALTER TABLE `briefings` MODIFY COLUMN `campaignPeriod` text NOT NULL;--> statement-breakpoint
ALTER TABLE `briefings` ADD `campaignName` varchar(255);--> statement-breakpoint
ALTER TABLE `briefings` ADD `mediaSpecs` text;--> statement-breakpoint
ALTER TABLE `briefings` ADD `locationSpecs` text;--> statement-breakpoint
ALTER TABLE `briefings` ADD `commercialTerms` text;--> statement-breakpoint
ALTER TABLE `briefings` ADD `moreDetails` text;--> statement-breakpoint
ALTER TABLE `briefings` ADD `creativityLevel` enum('baixo','medio','alto') DEFAULT 'medio' NOT NULL;--> statement-breakpoint
ALTER TABLE `briefings` ADD `generatedBy` varchar(50) DEFAULT 'ai';--> statement-breakpoint
ALTER TABLE `proposals` ADD `generatedBy` varchar(50) DEFAULT 'ai';