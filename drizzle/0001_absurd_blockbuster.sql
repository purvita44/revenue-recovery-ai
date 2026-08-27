CREATE TABLE `recoveryAuditEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` varchar(80) NOT NULL,
	`caseId` varchar(32) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`title` varchar(160) NOT NULL,
	`detail` text NOT NULL,
	`status` varchar(24) NOT NULL,
	`eventTimestamp` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recoveryAuditEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `recoveryAuditEvents_eventId_unique` UNIQUE(`eventId`)
);
