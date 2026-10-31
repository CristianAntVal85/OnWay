import { Global, Module, type DynamicModule } from '@nestjs/common';
import { FILE_STORAGE, InMemoryFileStorage, type FileStorage } from './file-storage.js';
import { FilesController } from './files.controller.js';
import { ImportedTracks } from './imported-tracks.js';
import { FilesService } from './files.service.js';

export interface FilesOptions {
  storage?: FileStorage;
}

/** Provides the `FileStorage` port, `ImportedTracks` (opens an uploaded file by id) and mounts `uploadFile`. Without options the in-memory store answers; `main.ts` passes the disk one (`createFileStorage`). */
@Global()
@Module({})
export class FilesModule {
  static register(options: FilesOptions = {}): DynamicModule {
    return {
      module: FilesModule,
      controllers: [FilesController],
      providers: [{ provide: FILE_STORAGE, useValue: options.storage ?? new InMemoryFileStorage() }, FilesService, ImportedTracks],
      exports: [FILE_STORAGE, ImportedTracks],
    };
  }
}
