ALTER TABLE `recoveryAuditEvents` ADD COLUMN `ownerOpenId` varchar(64) NOT NULL DEFAULT 'legacy';
CREATE INDEX `recoveryAuditEvents_ownerOpenId_idx` ON `recoveryAuditEvents` (`ownerOpenId`);
