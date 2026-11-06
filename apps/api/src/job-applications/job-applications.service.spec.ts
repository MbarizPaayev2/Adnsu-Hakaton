import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JobApplicationsService } from './job-applications.service';
import { PrismaService } from '../database/database.service';
import { PostHogService } from '../common/posthog.service';
import { LocalStorageService } from '../resumes/local-storage.service';

const baseCv = { id: 'res_1', userId: 'user_1', isBase: true, status: 'READY', fileUrl: '/uploads/base.docx', reviewedAt: null };

describe('JobApplicationsService', () => {
  let service: JobApplicationsService;
  let prisma: {
    application: Record<string, jest.Mock>;
    vacancy: Record<string, jest.Mock>;
    resume: Record<string, jest.Mock>;
  };
  let storage: { copyFile: jest.Mock; deleteFile: jest.Mock };
  let posthog: { capture: jest.Mock };

  beforeEach(async () => {
    storage = {
      copyFile: jest.fn().mockResolvedValue('/uploads/copy.docx'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    posthog = { capture: jest.fn() };
    prisma = {
      application: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      vacancy: {
        findUnique: jest.fn(),
      },
      resume: {
        findFirst: jest.fn().mockResolvedValue(baseCv),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobApplicationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PostHogService, useValue: posthog },
        { provide: LocalStorageService, useValue: storage },
      ],
    }).compile();

    service = module.get<JobApplicationsService>(JobApplicationsService);
  });

  describe('apply', () => {
    const vacancy = {
      id: 'vac_1',
      status: 'ACTIVE',
      deadline: null,
      company: { status: 'APPROVED' },
      questions: [{ id: 'q_1' }, { id: 'q_2' }],
    };

    // Required-question enforcement previously lived only in the apply form, so
    // a direct API call could file an application with mandatory questions blank.
    describe('required questions', () => {
      const withRequired = {
        ...vacancy,
        questions: [
          { id: 'q_1', label: 'Niyə bizimlə işləmək istəyirsiniz?', type: 'LONG_TEXT', required: true },
          { id: 'q_2', label: 'Əlavə qeyd', type: 'SHORT_TEXT', required: false },
        ],
      };

      it('rejects an application that omits a required question', async () => {
        prisma.vacancy.findUnique.mockResolvedValue(withRequired);

        await expect(
          service.apply('user_1', 'vac_1', { answers: [] } as any, []),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.application.create).not.toHaveBeenCalled();
      });

      it('treats a blank or whitespace-only answer as missing', async () => {
        prisma.vacancy.findUnique.mockResolvedValue(withRequired);

        for (const value of ['', '   ']) {
          await expect(
            service.apply('user_1', 'vac_1', { answers: [{ questionId: 'q_1', value }] } as any, []),
          ).rejects.toThrow(BadRequestException);
        }
        expect(prisma.application.create).not.toHaveBeenCalled();
      });

      it('names the unanswered questions so the applicant knows which to fill', async () => {
        prisma.vacancy.findUnique.mockResolvedValue(withRequired);

        await expect(
          service.apply('user_1', 'vac_1', { answers: [] } as any, []),
        ).rejects.toThrow(/Niyə bizimlə işləmək istəyirsiniz\?/);
      });

      it('accepts the application once every required question is answered', async () => {
        prisma.vacancy.findUnique.mockResolvedValue(withRequired);
        prisma.application.create.mockResolvedValue({ id: 'app_1' });

        await service.apply(
          'user_1',
          'vac_1',
          { answers: [{ questionId: 'q_1', value: 'Bəli' }] } as any,
          [],
        );
        expect(prisma.application.create).toHaveBeenCalled();
      });

      it('does not require optional questions', async () => {
        prisma.vacancy.findUnique.mockResolvedValue(withRequired);
        prisma.application.create.mockResolvedValue({ id: 'app_2' });

        await service.apply(
          'user_1',
          'vac_1',
          { answers: [{ questionId: 'q_1', value: 'Bəli' }] } as any,
          [],
        );
        expect(prisma.application.create).toHaveBeenCalled();
      });

      it('requires a real upload for a required file question', async () => {
        prisma.vacancy.findUnique.mockResolvedValue({
          ...vacancy,
          questions: [{ id: 'q_file', label: 'Portfolio', type: 'FILE_UPLOAD', required: true }],
        });

        await expect(
          service.apply(
            'user_1',
            'vac_1',
            { answers: [{ questionId: 'q_file', value: '/uploads/fake.pdf' }] } as any,
            [],
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts a required file question when its file was uploaded', async () => {
        prisma.vacancy.findUnique.mockResolvedValue({
          ...vacancy,
          questions: [{ id: 'q_file', label: 'Portfolio', type: 'FILE_UPLOAD', required: true }],
        });
        prisma.application.create.mockResolvedValue({ id: 'app_file' });

        await service.apply(
          'user_1',
          'vac_1',
          { answers: [{ questionId: 'q_file', value: '/uploads/real.pdf' }] } as any,
          [{ fieldName: 'q_file', fileUrl: '/uploads/real.pdf', originalName: 'real.pdf', mimeType: 'application/pdf' }],
        );

        expect(prisma.application.create).toHaveBeenCalled();
      });
    });

    it('rejects an answer whose questionId does not belong to the vacancy', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(vacancy);

      await expect(
        service.apply('user_1', 'vac_1', { answers: [{ questionId: 'q_foreign', value: 'x' }] } as any, []),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.application.create).not.toHaveBeenCalled();
    });

    it('creates the application when every answer references a real question', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(vacancy);
      prisma.application.create.mockResolvedValue({ id: 'app_1' });

      await service.apply('user_1', 'vac_1', { answers: [{ questionId: 'q_1', value: 'x' }] } as any, []);

      expect(prisma.application.create).toHaveBeenCalled();
    });

    it('attaches a private copy of the latest base CV, not the mutable base file', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(vacancy);
      prisma.resume.findFirst.mockResolvedValue(baseCv);
      prisma.application.create.mockResolvedValue({ id: 'app_1' });

      await service.apply('user_1', 'vac_1', {} as any, []);

      expect(storage.copyFile).toHaveBeenCalledWith('/uploads/base.docx');
      expect(prisma.application.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            files: {
              create: [
                expect.objectContaining({
                  fieldName: 'resume',
                  fileUrl: '/uploads/copy.docx',
                  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                }),
              ],
            },
          }),
        }),
      );
    });

    it('maps a unique-constraint violation to a friendly conflict', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(vacancy);
      prisma.application.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.apply('user_1', 'vac_1', {} as any, [])).rejects.toThrow(ConflictException);
    });

    it('removes the CV copy when the application insert fails', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(vacancy);
      prisma.resume.findFirst.mockResolvedValue(baseCv);
      prisma.application.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.apply('user_1', 'vac_1', {} as any, [])).rejects.toThrow(ConflictException);
      expect(storage.deleteFile).toHaveBeenCalledWith('/uploads/copy.docx');
    });

    it('maps an answer FK violation (questions replaced mid-request) to a conflict and removes the CV copy', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(vacancy);
      prisma.resume.findFirst.mockResolvedValue(baseCv);
      prisma.application.create.mockRejectedValue({ code: 'P2003' });

      await expect(service.apply('user_1', 'vac_1', {} as any, [])).rejects.toThrow(ConflictException);
      expect(storage.deleteFile).toHaveBeenCalledWith('/uploads/copy.docx');
    });

    it('keeps a committed application and its CV copy when analytics throws', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(vacancy);
      prisma.resume.findFirst.mockResolvedValue(baseCv);
      prisma.application.create.mockResolvedValue({ id: 'app_1', files: [] });
      posthog.capture.mockImplementation(() => {
        throw new Error('posthog down');
      });

      await expect(service.apply('user_1', 'vac_1', {} as any, [])).resolves.toEqual({ id: 'app_1', files: [] });
      expect(posthog.capture).toHaveBeenCalled();
      expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    it('removes the CV copy and rethrows when the database write fails', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(vacancy);
      prisma.resume.findFirst.mockResolvedValue(baseCv);
      const dbError = new Error('connection lost');
      prisma.application.create.mockRejectedValue(dbError);

      await expect(service.apply('user_1', 'vac_1', {} as any, [])).rejects.toBe(dbError);
      expect(storage.deleteFile).toHaveBeenCalledWith('/uploads/copy.docx');
      expect(posthog.capture).not.toHaveBeenCalled();
    });

    it('refuses to apply when the base CV was replaced before it could be copied', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(vacancy);
      prisma.resume.findFirst
        .mockResolvedValueOnce(baseCv)
        .mockResolvedValueOnce(null);
      storage.copyFile.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }));

      await expect(service.apply('user_1', 'vac_1', {} as any, [])).rejects.toThrow(ConflictException);
      expect(prisma.application.create).not.toHaveBeenCalled();
    });

    it('asks for a re-upload when the current base CV file is missing', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(vacancy);
      prisma.resume.findFirst.mockResolvedValue(baseCv);
      storage.copyFile.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }));

      await expect(service.apply('user_1', 'vac_1', {} as any, [])).rejects.toThrow(BadRequestException);
      expect(prisma.application.create).not.toHaveBeenCalled();
    });

    describe('CV choice', () => {
      beforeEach(() => {
        prisma.vacancy.findUnique.mockResolvedValue(vacancy);
        prisma.application.create.mockResolvedValue({ id: 'app_cv' });
      });

      it('refuses an application when the candidate has no usable base CV', async () => {
        prisma.resume.findFirst.mockResolvedValue(null);

        await expect(service.apply('user_1', 'vac_1', {} as any, [])).rejects.toThrow(BadRequestException);
        expect(prisma.resume.findFirst).toHaveBeenCalledWith(expect.objectContaining({
          where: { userId: 'user_1', isBase: true, status: 'READY', fileUrl: { not: null } },
        }));
        expect(storage.copyFile).not.toHaveBeenCalled();
        expect(prisma.application.create).not.toHaveBeenCalled();
      });

      it('looks up a chosen CV only among the candidate\'s own and answers 404 otherwise', async () => {
        prisma.resume.findFirst.mockResolvedValue(null);

        await expect(service.apply('user_1', 'vac_1', { resumeId: 'res_foreign' } as any, [])).rejects.toThrow(NotFoundException);
        expect(prisma.resume.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'res_foreign', userId: 'user_1' } }));
        expect(storage.copyFile).not.toHaveBeenCalled();
        expect(prisma.application.create).not.toHaveBeenCalled();
      });

      it.each([
        ['a pending tailored CV', { isBase: false, status: 'PENDING', fileUrl: null, reviewedAt: null }],
        ['a tailored draft awaiting review', { isBase: false, status: 'NEEDS_REVIEW', fileUrl: null, reviewedAt: null }],
        ['a failed tailored CV', { isBase: false, status: 'FAILED', fileUrl: null, reviewedAt: null }],
        ['a legacy READY tailored CV never reviewed', { isBase: false, status: 'READY', fileUrl: '/uploads/old.pdf', reviewedAt: null }],
        ['a base CV that is not READY', { isBase: true, status: 'PENDING', fileUrl: '/uploads/base.docx', reviewedAt: null }],
        ['a READY row without a file', { isBase: true, status: 'READY', fileUrl: null, reviewedAt: null }],
      ])('refuses %s with 400', async (_label, row) => {
        prisma.resume.findFirst.mockResolvedValue({ id: 'res_x', userId: 'user_1', ...row });

        await expect(service.apply('user_1', 'vac_1', { resumeId: 'res_x' } as any, [])).rejects.toThrow(BadRequestException);
        expect(storage.copyFile).not.toHaveBeenCalled();
        expect(prisma.application.create).not.toHaveBeenCalled();
      });

      it('attaches a copy of a reviewed READY tailored CV the candidate chose', async () => {
        prisma.resume.findFirst.mockResolvedValue({
          id: 'res_t', userId: 'user_1', isBase: false, status: 'READY', fileUrl: '/uploads/tailored.pdf', reviewedAt: new Date(),
        });
        storage.copyFile.mockResolvedValue('/uploads/tailored-copy.pdf');

        await service.apply('user_1', 'vac_1', { resumeId: 'res_t' } as any, []);

        expect(storage.copyFile).toHaveBeenCalledWith('/uploads/tailored.pdf');
        expect(prisma.application.create.mock.calls[0][0].data.files.create[0]).toEqual(expect.objectContaining({
          fieldName: 'resume', fileUrl: '/uploads/tailored-copy.pdf', mimeType: 'application/pdf',
        }));
      });
    });

    it('rejects when the vacancy is not active', async () => {
      prisma.vacancy.findUnique.mockResolvedValue({ ...vacancy, status: 'PAUSED' });
      await expect(service.apply('user_1', 'vac_1', {} as any, [])).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown vacancy', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(null);
      await expect(service.apply('user_1', 'vac_1', {} as any, [])).rejects.toThrow(NotFoundException);
    });
  });

  describe('findEmployerApplications', () => {
    it('flattens to the shape the frontend list page reads', async () => {
      prisma.application.findMany.mockResolvedValue([
        {
          id: 'app_1',
          status: 'APPLIED',
          createdAt: new Date('2026-01-01'),
          user: { name: 'Alex', email: 'alex@b.com' },
          vacancy: { title: 'Engineer' },
        },
      ]);

      const result = await service.findEmployerApplications('company_1');

      expect(result).toEqual([
        { id: 'app_1', candidateName: 'Alex', vacancyTitle: 'Engineer', status: 'APPLIED', createdAt: new Date('2026-01-01') },
      ]);
    });

    it('falls back to email when the candidate has no name', async () => {
      prisma.application.findMany.mockResolvedValue([
        { id: 'app_1', status: 'APPLIED', createdAt: new Date(), user: { name: null, email: 'alex@b.com' }, vacancy: { title: 'Engineer' } },
      ]);

      const [result] = await service.findEmployerApplications('company_1');
      expect(result.candidateName).toBe('alex@b.com');
    });
  });

  describe('findEmployerApplicationDetail', () => {
    it('flattens candidate info, experiences, and answers into the shape the detail page reads', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: 'app_1',
        status: 'APPLIED',
        createdAt: new Date('2026-01-01'),
        vacancy: { title: 'Engineer' },
        user: {
          name: 'Alex',
          email: 'alex@b.com',
          profile: {
            phone: '+994501234567',
            experiences: [{ title: 'Dev', company: 'Acme', startDate: new Date('2024-01-01'), endDate: null, description: 'Built things' }],
          },
        },
        files: [
          { fieldName: 'q_file', fileUrl: '/uploads/portfolio.pdf' },
          { fieldName: 'resume', fileUrl: '/uploads/cv.pdf' },
        ],
        answers: [{ question: { label: 'Why us?' }, value: 'Because', fileUrl: null }],
      });

      const result = await service.findEmployerApplicationDetail('app_1', 'company_1');

      expect(result).toMatchObject({
        candidateName: 'Alex',
        candidateEmail: 'alex@b.com',
        candidatePhone: '+994501234567',
        resumeUrl: '/uploads/cv.pdf',
        experiences: [{ title: 'Dev', company: 'Acme', description: 'Built things' }],
        answers: [{ questionLabel: 'Why us?', value: 'Because' }],
      });
    });

    it('handles a candidate with no profile/experience gracefully', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: 'app_1',
        status: 'APPLIED',
        createdAt: new Date(),
        vacancy: { title: 'Engineer' },
        user: { name: 'Alex', email: 'alex@b.com', profile: null },
        files: [],
        answers: [],
      });

      const result = await service.findEmployerApplicationDetail('app_1', 'company_1');
      expect(result.experiences).toEqual([]);
      expect(result.candidatePhone).toBeNull();
      expect(result.resumeUrl).toBeNull();
    });

    it('rejects an application belonging to another company', async () => {
      prisma.application.findFirst.mockResolvedValue(null);
      await expect(service.findEmployerApplicationDetail('app_1', 'company_1')).rejects.toThrow(NotFoundException);
    });
  });
});
