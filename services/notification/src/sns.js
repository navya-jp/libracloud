// Email delivery through Amazon SNS.
//
// Why SNS and not SES? Amazon SES is not available in AWS Academy Learner Lab.
// SNS can deliver email to confirmed subscribers of a topic. In this project the
// topic "libracloud-notifications" is subscribed by the library's email address,
// so every member notification is delivered there (the member's name and email
// appear in the message). In production you would switch this file to SES to
// email each member directly - nothing else in the system changes.

const { logger } = require('../../shared');

const TOPIC = process.env.SNS_TOPIC_ARN || '';
const REGION = process.env.AWS_REGION || 'us-east-1';
let client;

function snsClient() {
  if (!client) {
    const { SNSClient } = require('@aws-sdk/client-sns');
    client = new SNSClient({ region: REGION });
  }
  return client;
}

// SNS email subjects: max 100 chars, printable ASCII, no line breaks.
function cleanSubject(s) {
  return `[LibraCloud] ${s}`.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function formatEmail({ name, email, message, type }) {
  return [
    `To: ${name || 'Member'} <${email || 'unknown'}>`,
    '',
    message,
    '',
    '---',
    `Notification type: ${type}`,
    'LibraCloud Library - this is an automated message.',
  ].join('\n');
}

async function sendEmail(n) {
  if (!TOPIC) {
    logger.info('email_logged_only', { type: n.type, to: n.email, subject: n.subject });
    return { channel: 'log', status: 'logged' };
  }
  const { PublishCommand } = require('@aws-sdk/client-sns');
  const out = await snsClient().send(new PublishCommand({
    TopicArn: TOPIC,
    Subject: cleanSubject(n.subject),
    Message: formatEmail(n),
    MessageAttributes: { type: { DataType: 'String', StringValue: n.type } },
  }));
  return { channel: 'sns', status: 'sent', messageId: out.MessageId };
}

module.exports = { sendEmail, cleanSubject, formatEmail };
