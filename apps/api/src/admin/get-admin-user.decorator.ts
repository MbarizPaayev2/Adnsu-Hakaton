import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetAdminUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    if (data) {
      return request.adminUser[data];
    }
    return request.adminUser;
  },
);
