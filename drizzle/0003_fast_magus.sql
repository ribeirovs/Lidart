ALTER TABLE `proposals` MODIFY COLUMN `proposalContent` mediumtext NOT NULL;--> statement-breakpoint
ALTER TABLE `briefings` ADD `targetAudience` text NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `currentStage` enum('briefing','validation','research','inventory','pricing','product_content','idea_central','idea_validation','valuation','valuation_validation','proposal_final','customization','approval','delivery') DEFAULT 'briefing' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `chatHistory` text;