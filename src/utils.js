import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { saveImage, clearImages, getImage } from './services/storage';

// Convert a File object to a base64 string
export const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
    });
};

export const exportProjectToZip = async (state, imagesData) => {
    const zip = new JSZip();

    const stateToSave = {
        ...state,
        images: state.images.map(img => ({
            ...img,
            file: null, // removing the File object reference as it can't be serialized
            objectUrl: null // removing ephemeral URL
        }))
    };

    zip.file("state.json", JSON.stringify(stateToSave, null, 2));

    const imgFolder = zip.folder("images");

    for (const img of state.images) {
        const base64Data = imagesData[img.id] || await getImage(img.id);
        if (base64Data) {
            // Extract just the raw base64 string
            const base64Str = base64Data.split(',')[1];
            // Try to determine extension
            let ext = 'png';
            if (base64Data.includes('image/jpeg')) ext = 'jpg';
            if (base64Data.includes('image/webp')) ext = 'webp';

            imgFolder.file(`${img.name}.${ext}`, base64Str, { base64: true });
        }
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `grok_prompter_project_${new Date().getTime()}.zip`);
};

export const importProjectFromZip = async (zipFile) => {
    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(zipFile);

    const stateFile = loadedZip.file("state.json");
    if (!stateFile) {
        throw new Error('Invalid project file: missing state.json');
    }

    const stateContent = await stateFile.async("string");
    const state = JSON.parse(stateContent);

    // Clear existing IndexedDB images
    await clearImages();

    const restoredImages = [];

    for (const imgMeta of state.images) {
        // Find the corresponding image file in the zip
        const fileMatches = Object.keys(loadedZip.files).filter(k => k.startsWith(`images/${imgMeta.name}.`));

        if (fileMatches.length > 0) {
            const imgFile = loadedZip.file(fileMatches[0]);
            const base64Str = await imgFile.async("base64");

            // Reconstruct data URI
            let mime = 'image/png';
            if (fileMatches[0].endsWith('.jpg')) mime = 'image/jpeg';
            if (fileMatches[0].endsWith('.webp')) mime = 'image/webp';

            const fullBase64 = `data:${mime};base64,${base64Str}`;

            // Save to IndexedDB
            await saveImage(imgMeta.id, fullBase64);

            restoredImages.push({
                ...imgMeta,
                base64: fullBase64 // keep in memory temporarily for rendering
            });
        } else {
            restoredImages.push(imgMeta);
        }
    }

    return { ...state, images: restoredImages };
};
