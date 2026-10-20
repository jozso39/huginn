-- Gmail answers /mail/u/<address>/ with an error page; ?authuser=<address> opens the
-- mailbox. The address in the old links is URL-encoded already, as a query value needs.
UPDATE `items`
SET `url` = 'https://mail.google.com/mail/?authuser='
  || substr(`url`, 32, instr(`url`, '/#all/') - 32)
  || '#all/'
  || substr(`url`, instr(`url`, '/#all/') + 6)
WHERE `url` LIKE 'https://mail.google.com/mail/u/%/#all/%';
