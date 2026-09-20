import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');
    const port = config.get<number>('SMTP_PORT') ?? 587;
    this.from = config.get<string>('EMAIL_FROM') ?? 'UZANITE <no-reply@uzanite.local>';

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    } else {
      this.transporter = null;
      this.logger.warn('SMTP not configured — emails will be logged, not sent');
    }
  }

  async send(message: { to: string; subject: string; html: string; text?: string }): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[email-disabled] to=${message.to} subject="${message.subject}"`);
      return;
    }
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}
