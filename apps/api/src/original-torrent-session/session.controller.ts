import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  OriginalTorrentSessionConflictError,
  OriginalTorrentSessionInputError,
  OriginalTorrentSessionNotFoundError,
} from './session.errors';
import {
  parseCreateOriginalTorrentSessionBody,
  parseOriginalTorrentFileSelectionBody,
  parseOriginalTorrentSessionId,
} from './session.parsing';
import { OriginalTorrentSessionService } from './session.service';

@ApiTags('original-torrent-sessions')
@Controller('media/torrent-sessions')
export class OriginalTorrentSessionController {
  constructor(private readonly sessions: OriginalTorrentSessionService) {}

  @ApiOperation({
    summary: 'Create a server-owned original torrent session.',
    description:
      'Selects only a provider observation resolved again by the API. Raw magnets, hashes, upstream URLs, paths, and TorrServer targets are not accepted.',
  })
  @ApiAcceptedResponse({
    description:
      'Session creation started. Poll the returned ID until selection_required, ready, or failed.',
  })
  @ApiBadRequestResponse({ description: 'Invalid or unbounded session input.' })
  @ApiConflictResponse({ description: 'The session runtime is shutting down.' })
  @HttpCode(202)
  @Post()
  create(@Body() body: unknown) {
    return mapHttpErrors(() =>
      this.sessions.create(parseCreateOriginalTorrentSessionBody(body)),
    );
  }

  @ApiOperation({ summary: 'Read an original torrent session snapshot.' })
  @ApiParam({ name: 'id', description: 'Bounded random session ID.' })
  @ApiOkResponse({ description: 'Current server-owned session snapshot.' })
  @ApiBadRequestResponse({ description: 'Invalid session ID.' })
  @ApiNotFoundResponse({
    description: 'Session not found or no longer retained.',
  })
  @Get(':id')
  get(@Param('id') id: string) {
    return mapHttpErrors(() =>
      this.sessions.get(parseOriginalTorrentSessionId(id)),
    );
  }

  @ApiOperation({
    summary: 'Select one server-offered torrent file by numeric ID.',
  })
  @ApiParam({ name: 'id', description: 'Bounded random session ID.' })
  @ApiOkResponse({ description: 'Updated session snapshot.' })
  @ApiBadRequestResponse({ description: 'Invalid session or file ID input.' })
  @ApiNotFoundResponse({
    description: 'Session not found or no longer retained.',
  })
  @ApiConflictResponse({
    description: 'The file was not offered or the session is in another state.',
  })
  @HttpCode(200)
  @Post(':id/selection')
  select(@Param('id') id: string, @Body() body: unknown) {
    return mapHttpErrors(() =>
      this.sessions.selectFile(
        parseOriginalTorrentSessionId(id),
        parseOriginalTorrentFileSelectionBody(body),
      ),
    );
  }

  @ApiOperation({
    summary: 'Stop a session and release its torrent reference.',
  })
  @ApiParam({ name: 'id', description: 'Bounded random session ID.' })
  @ApiNoContentResponse({
    description: 'Session stopped and its reference released.',
  })
  @ApiBadRequestResponse({ description: 'Invalid session ID.' })
  @ApiNotFoundResponse({
    description: 'Session not found or no longer retained.',
  })
  @HttpCode(204)
  @Delete(':id')
  async stop(@Param('id') id: string): Promise<void> {
    await mapHttpErrors(() =>
      this.sessions.stop(parseOriginalTorrentSessionId(id)),
    );
  }
}

async function mapHttpErrors<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OriginalTorrentSessionInputError) {
      throw new BadRequestException(error.message);
    }
    if (error instanceof OriginalTorrentSessionNotFoundError) {
      throw new NotFoundException(error.message);
    }
    if (error instanceof OriginalTorrentSessionConflictError) {
      throw new ConflictException({
        statusCode: 409,
        code: error.code,
        message: error.message,
        error: 'Conflict',
      });
    }
    throw error;
  }
}
