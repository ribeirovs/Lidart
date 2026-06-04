CREATE TABLE `proposals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`clientName` varchar(255) NOT NULL,
	`clientCompany` varchar(255) NOT NULL,
	`clientContact` varchar(255),
	`projectScope` text NOT NULL,
	`values` varchar(255) NOT NULL,
	`deadline` varchar(255),
	`commercialTerms` text,
	`proposalContent` text NOT NULL,
	`status` enum('draft','sent','accepted','rejected','archived') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `proposals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `proposals` ADD CONSTRAINT `proposals_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;