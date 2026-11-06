import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './database/database.service';
import { JobsService } from './jobs/jobs.service';
import * as bcrypt from 'bcrypt';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const jobsService = app.get(JobsService);

  console.log('--- SEEDING DATABASE ---');

  // 1. Clean database
  //
  // Deleted deepest-dependency-first rather than relying on cascades. Two
  // reasons this order is explicit:
  //
  //  - ApplicationAnswer -> ApplicationQuestion is onDelete: Restrict, so
  //    removing a vacancy's questions while answers still reference them
  //    fails. Answers must go before questions, which a single
  //    business.deleteMany() cascade does not guarantee.
  //  - The B2B and admin tables were previously not cleaned at all, so
  //    `npm run db:seed` succeeded once on an empty database and then failed
  //    on every later run with a unique-constraint error on
  //    business.create() (hr@techcorp.com already existed).
  console.log('Cleaning database...');

  // Applications and their children.
  await prisma.applicationAnswer.deleteMany({});
  await prisma.applicationFile.deleteMany({});
  await prisma.application.deleteMany({});

  // Vacancy questions, then the vacancies themselves.
  await prisma.applicationQuestionOption.deleteMany({});
  await prisma.applicationQuestion.deleteMany({});
  await prisma.vacancy.deleteMany({});

  // Employer side: opportunities -> company -> sessions/tokens -> business.
  await prisma.volunteerOpportunity.deleteMany({});
  await prisma.company.deleteMany({});
  await prisma.businessSession.deleteMany({});
  await prisma.businessVerificationToken.deleteMany({});
  await prisma.business.deleteMany({});

  // Admin audit trail and sessions (AdminUser itself is upserted below).
  await prisma.adminAuditLog.deleteMany({});
  await prisma.adminSession.deleteMany({});

  // Job-seeker side.
  await prisma.externalApplicationAnswer.deleteMany({});
  await prisma.externalApplication.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.verificationToken.deleteMany({});
  await prisma.resume.deleteMany({});
  await prisma.match.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.experience.deleteMany({});
  await prisma.education.deleteMany({});
  await prisma.profile.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.user.deleteMany({});

  // 2. Create default user
  console.log('Creating default test user: user@example.com (password: password123)...');
  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await prisma.user.create({
    data: {
      email: 'user@example.com',
      hashedPassword,
      name: 'Alex Developer',
      emailVerified: new Date(), // Seeded user skips the email-verification gate on login
      subscription: {
        create: {
          plan: 'Limitsiz', // Seed on the top tier to test all features
          status: 'active',
        },
      },
    },
  });

  // 3. Create profile
  console.log('Creating profile for test user...');
  const profile = await prisma.profile.create({
    data: {
      userId: user.id,
      headline: 'Senior Full Stack Engineer',
      skills: ['TypeScript', 'JavaScript', 'React', 'Next.js', 'NestJS', 'Node.js', 'PostgreSQL', 'Tailwind CSS'],
      location: 'Bakı, Azərbaycan',
      jobPreferences: {
        roles: ['Software Engineer', 'Full Stack Developer', 'Backend Developer'],
        types: ['remote', 'hybrid'],
        // Monthly AZN, matching the ranges the vacancy form and pricing use.
        locations: ['Uzaqdan', 'Bakı', 'Sumqayıt'],
        salaryMin: 2500,
        salaryMax: 5000,
      },
      experiences: {
        create: [
          {
            title: 'Full Stack Engineer',
            company: 'Tech Corp',
            startDate: new Date('2023-01-15'),
            description: 'React, TypeScript və NestJS ilə bulud mühitində müasir veb tətbiqlər hazırlamışam.',
          },
          {
            title: 'Web Developer',
            company: 'Dizayn Studiya',
            startDate: new Date('2021-06-01'),
            endDate: new Date('2022-12-31'),
            description: 'Müştərilər üçün adaptiv saytlar və e-ticarət tətbiqləri qurmuşam.',
          },
        ],
      },
      education: {
        create: [
          {
            institution: 'Bakı Dövlət Universiteti',
            degree: 'Bakalavr',
            fieldOfStudy: 'Kompüter elmləri',
            startDate: new Date('2017-09-01'),
            endDate: new Date('2021-05-15'),
          },
        ],
      },
    },
  });

  // 4. Ingest sample jobs
  console.log('Ingesting mock job listings...');
  
  // Job 1: High Match (Frontend/Fullstack React/TS)
  const job1 = await jobsService.ingestJob({
    externalId: 'job-1',
    title: 'Senior Software Engineer (React / TypeScript)',
    company: 'Innovate AI',
    location: 'Uzaqdan · Bakı',
    url: 'https://example.com/jobs/1',
    postedAt: new Date().toISOString(),
    description: 'We are seeking a Senior Software Engineer to build our AI dashboards. Requirements: Strong experience with React, TypeScript, and Tailwind CSS. Node.js backend knowledge is a big plus. Fully remote role.',
    // Glorri-shaped payload: the matcher parses detail.* for requirements,
    // languages and salary — a bare {source} marker would score on empty text.
    rawPayload: {
      title: 'Senior Software Engineer (React / TypeScript)',
      slug: 'job-1',
      location: 'Uzaqdan · Bakı',
      experience: '3 ildən 5 ilə qədər',
      education: 'Ali',
      salaryFrom: 2500,
      salaryTo: 5000,
      salaryCurrency: 'AZN',
      status: 'approved',
      company: { slug: 'innovate-ai', name: 'Innovate AI' },
      detail: {
        title: 'Senior Software Engineer (React / TypeScript)',
        company_name: 'Innovate AI',
        location: 'Uzaqdan · Bakı',
        description_text: 'We are seeking a Senior Software Engineer to build our AI dashboards.',
        requirements_text: 'Strong experience with React, TypeScript, and Tailwind CSS. Node.js backend knowledge is a big plus. Fully remote role. Fluent in Azerbaijani and English.',
        category: 'IT',
      },
    },
  });
  console.log(`Ingested Job 1 (React/TS remote): ID ${job1.id}`);

  // Job 2: Medium Match (Backend NestJS)
  const job2 = await jobsService.ingestJob({
    externalId: 'job-2',
    title: 'NestJS Backend Developer',
    company: 'SaaS Solutions',
    location: 'Hibrid · Bakı',
    url: 'https://example.com/jobs/2',
    postedAt: new Date().toISOString(),
    description: 'Looking for a backend engineer to design scalable APIs. Must have solid experience with NestJS, Node.js, PostgreSQL, and typescript. Hybrid work setting with 2 days in our NYC office.',
    rawPayload: {
      title: 'NestJS Backend Developer',
      slug: 'job-2',
      location: 'Hibrid · Bakı',
      experience: '1 ildən 3 ilə qədər',
      education: 'Ali',
      salaryFrom: 2000,
      salaryTo: 3500,
      salaryCurrency: 'AZN',
      status: 'approved',
      company: { slug: 'saas-solutions', name: 'SaaS Solutions' },
      detail: {
        title: 'NestJS Backend Developer',
        company_name: 'SaaS Solutions',
        location: 'Hibrid · Bakı',
        description_text: 'Looking for a backend engineer to design scalable APIs.',
        requirements_text: 'Must have solid experience with NestJS, Node.js, PostgreSQL, and TypeScript. Hybrid work setting. Azerbaijani and English required.',
        category: 'IT',
      },
    },
  });
  console.log(`Ingested Job 2 (NestJS Backend hybrid): ID ${job2.id}`);

  // Job 3: No Match (Sales Manager)
  const job3 = await jobsService.ingestJob({
    externalId: 'job-3',
    title: 'Senior Sales Manager',
    company: 'Global Retail',
    location: 'Ofisdə · Sumqayıt',
    url: 'https://example.com/jobs/3',
    postedAt: new Date().toISOString(),
    description: 'Lead our retail sales division. Requires 5+ years of B2B sales management. Tech skills not required, but leadership and communication skills are essential.',
    rawPayload: {
      title: 'Senior Sales Manager',
      slug: 'job-3',
      location: 'Ofisdə · Sumqayıt',
      experience: '5 ildən artıq',
      education: 'Ali',
      salaryFrom: 1500,
      salaryTo: 2500,
      salaryCurrency: 'AZN',
      status: 'approved',
      company: { slug: 'global-retail', name: 'Global Retail' },
      detail: {
        title: 'Senior Sales Manager',
        company_name: 'Global Retail',
        location: 'Ofisdə · Sumqayıt',
        description_text: 'Lead our retail sales division.',
        requirements_text: 'Requires 5+ years of B2B sales management. Tech skills not required, but leadership and communication skills are essential. Azerbaijani, Russian and English required.',
        category: 'Sales',
      },
    },
  });
  console.log(`Ingested Job 3 (Sales Manager onsite): ID ${job3.id}`);

  // 5. Seed B2B Employer Data
  console.log('Seeding B2B Employer data...');
  
  // Create an APPROVED business
  const b2bPassword = await bcrypt.hash('employer123', 10);
  const businessAppr = await prisma.business.create({
    data: {
      email: 'hr@techcorp.com',
      hashedPassword: b2bPassword,
      emailVerified: new Date(),
      company: {
        create: {
          name: 'Tech Corp',
          description: 'A leading tech company',
          status: 'APPROVED'
        }
      }
    },
    include: { company: true }
  });

  // Create active vacancy
  const vacActive = await prisma.vacancy.create({
    data: {
      companyId: businessAppr.company!.id,
      title: 'Full Stack Engineer',
      status: 'ACTIVE',
      questions: {
        create: [
          {
            label: 'Niyə bizimlə işləmək istəyirsiniz?',
            type: 'LONG_TEXT',
            required: true,
            order: 1
          }
        ]
      }
    },
    include: { questions: true }
  });

  // Create another active vacancy
  await prisma.vacancy.create({
    data: {
      companyId: businessAppr.company!.id,
      title: 'DevOps Engineer',
      status: 'ACTIVE'
    }
  });

  // Create a paused vacancy
  await prisma.vacancy.create({
    data: {
      companyId: businessAppr.company!.id,
      title: 'Product Manager',
      status: 'PAUSED'
    }
  });

  // Create a PENDING business
  await prisma.business.create({
    data: {
      email: 'startup@pending.com',
      hashedPassword: b2bPassword,
      emailVerified: new Date(),
      company: {
        create: {
          name: 'Pending Startup Inc.',
          status: 'PENDING'
        }
      }
    }
  });

  // Create a REJECTED business
  await prisma.business.create({
    data: {
      email: 'spammy@rejected.com',
      hashedPassword: b2bPassword,
      emailVerified: new Date(),
      company: {
        create: {
          name: 'Spammy Recruiting',
          status: 'REJECTED',
          rejectionReason: 'Does not meet platform standards'
        }
      }
    }
  });

  // 6. Create sample job applications
  console.log('Creating sample job applications...');
  await prisma.application.create({
    data: {
      userId: user.id,
      vacancyId: vacActive.id,
      status: 'APPLIED',
      answers: {
        create: [
          {
            question: { connect: { id: vacActive.questions[0]?.id } },
            value: 'I love tech!'
          }
        ]
      }
    }
  });

  // 7. Create a default admin operator for local dev (production admins are
  // bootstrapped via `npm run script:create-admin`, never seeded).
  console.log('Creating default admin user: admin@example.com (password: admin12345)...');
  const adminPassword = await bcrypt.hash('admin12345', 10);
  await prisma.adminUser.upsert({
    where: { email: 'admin@example.com' },
    update: { hashedPassword: adminPassword },
    create: { email: 'admin@example.com', hashedPassword: adminPassword, name: 'Local Admin' },
  });

  console.log('--- SEEDING COMPLETED SUCCESSFULLY ---');
  await app.close();
}

bootstrap().catch((err) => {
  console.error('Seeding failed', err);
  process.exit(1);
});
