import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetBusiness = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    if (data) {
      return request.business[data];
    }
    return request.business;
  },
);
