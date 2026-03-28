/**
 * StreamParser - Memory-safe parsing of large bootstrap files
 * Handles 1GB+ files without loading into memory
 */

const fs = require('fs');
const readline = require('readline');
const CognitiveAnchor = require('../core/CognitiveAnchor');

class StreamParser {
    constructor(options = {}) {
        this.options = {
            chunkSize: options.chunkSize || 500,        // Target tokens per segment
            maxChunkSize: options.maxChunkSize || 1000, // Hard limit
            overlapTokens: options.overlapTokens || 50, // Context continuity
            rssLimit: options.rssLimit || 500 * 1024 * 1024, // 500MB default
            flushCallback: options.flushCallback || null,
            ...options
        };

        this.stats = {
            bytesProcessed: 0,
            segmentsEmitted: 0,
            capsExtracted: 0,
            flushCount: 0
        };

        // Segment detection patterns
        this.patterns = {
            header: /^#{1,6}\s+.+$/,
            decision: /\b(decided|concluded|determined|chose|selected)\b/i,
            insight: /\b(realized|discovered|found|learned|understood)\b/i,
            question: /\b(how|why|what|when|should|could|would)\b.*\?/i,
            reasoning: /\b(because|therefore|thus|hence|since|given that)\b/i,
            contradiction: /\b(but|however|although|despite|unlike|contrary)\b/i,
            supersession: /\b(instead|rather|now|updated|revised|replaced)\b/i,
            codeBlock: /^```/,
            listItem: /^[\s]*[-*+]\s+$/,
            separator: /^[-=_]{3,}$/
        };
    }

    /**
     * Stream parse a large file, yielding segments
     * @param {string} filePath 
     * @yields {Object} segment with content and metadata
     */
    async *parseFile(filePath) {
        const fileStream = fs.createReadStream(filePath, {
            encoding: 'utf8',
            highWaterMark: 64 * 1024 // 64KB chunks from fs
        });

        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let currentSegment = {
            lines: [],
            tokens: 0,
            startLine: 0,
            type: 'content',
            inCodeBlock: false,
            headers: []  // Track hierarchy
        };

        let lineNumber = 0;
        let lastHeader = null;

        for await (const line of rl) {
            lineNumber++;
            this.stats.bytesProcessed += Buffer.byteLength(line, 'utf8');

            const lineTokens = Math.ceil(line.length / 4);

            // Check for segment boundaries
            const boundary = this.detectBoundary(line, currentSegment);

            if (boundary.isBreak && currentSegment.lines.length > 0) {
                // Yield current segment
                const segment = this.finalizeSegment(currentSegment, lastHeader);
                yield segment;
                this.stats.segmentsEmitted++;

                // Check memory pressure
                await this.checkMemoryPressure();

                // Start new segment with optional overlap
                currentSegment = {
                    lines: boundary.carryOver || [],
                    tokens: boundary.carryOver?.reduce((sum, l) => sum + Math.ceil(l.length / 4), 0) || 0,
                    startLine: lineNumber,
                    type: boundary.nextType || 'content',
                    inCodeBlock: boundary.inCodeBlock || false,
                    headers: [...currentSegment.headers]
                };
            }

            // Track headers for hierarchy
            if (this.patterns.header.test(line)) {
                const level = line.match(/^(#+)/)[1].length;
                lastHeader = { level, text: line.replace(/^#+\s*/, ''), line: lineNumber };

                // Maintain header stack
                currentSegment.headers = currentSegment.headers.filter(h => h.level < level);
                currentSegment.headers.push(lastHeader);
            }

            // Track code blocks
            if (this.patterns.codeBlock.test(line)) {
                currentSegment.inCodeBlock = !currentSegment.inCodeBlock;
            }

            // Add line to current segment
            currentSegment.lines.push(line);
            currentSegment.tokens += lineTokens;

            // Force break if segment too large
            if (currentSegment.tokens >= this.options.maxChunkSize && !currentSegment.inCodeBlock) {
                const segment = this.finalizeSegment(currentSegment, lastHeader);
                yield segment;
                this.stats.segmentsEmitted++;

                // Overlap for continuity
                const overlapLines = this.getOverlapLines(currentSegment.lines);
                currentSegment = {
                    lines: overlapLines,
                    tokens: overlapLines.reduce((sum, l) => sum + Math.ceil(l.length / 4), 0),
                    startLine: lineNumber,
                    type: 'content',
                    inCodeBlock: false,
                    headers: [...currentSegment.headers]
                };
            }
        }

        // Final segment
        if (currentSegment.lines.length > 0) {
            yield this.finalizeSegment(currentSegment, lastHeader);
            this.stats.segmentsEmitted++;
        }
    }

    detectBoundary(line, currentSegment) {
        const result = {
            isBreak: false,
            nextType: null,
            carryOver: null,
            inCodeBlock: currentSegment.inCodeBlock
        };

        // Don't break inside code blocks
        if (currentSegment.inCodeBlock) {
            if (this.patterns.codeBlock.test(line)) {
                result.inCodeBlock = false;
            }
            return result;
        }

        // Major structural breaks
        if (this.patterns.separator.test(line)) {
            result.isBreak = true;
            return result;
        }

        // Header = new section
        if (this.patterns.header.test(line)) {
            const level = line.match(/^(#+)/)[1].length;
            if (level <= 2 && currentSegment.tokens > 100) {
                result.isBreak = true;
                result.carryOver = [line];
                return result;
            }
        }

        // Natural paragraph break after sufficient content
        if (line.trim() === '' && currentSegment.tokens >= this.options.chunkSize * 0.7) {
            result.isBreak = true;
            return result;
        }

        return result;
    }

    finalizeSegment(segment, lastHeader) {
        const content = segment.lines.join('\n').trim();

        // Detect segment characteristics
        const characteristics = this.analyzeContent(content);

        return {
            content,
            tokens: segment.tokens,
            lineStart: segment.startLine,
            lineEnd: segment.startLine + segment.lines.length - 1,
            headers: segment.headers.map(h => h.text),
            type: characteristics.primaryType,
            signals: characteristics.signals,
            relationships: characteristics.relationships
        };
    }

    analyzeContent(content) {
        const signals = [];
        const relationships = {
            depends_on_hints: [],
            contradicts_hints: [],
            supersedes_hints: []
        };

        if (this.patterns.decision.test(content)) signals.push('decision');
        if (this.patterns.insight.test(content)) signals.push('insight');
        if (this.patterns.question.test(content)) signals.push('question');
        if (this.patterns.reasoning.test(content)) signals.push('reasoning');

        const lines = content.split('\n');
        for (const line of lines) {
            const becauseMatch = line.match(/because (?:of )?(.+?)(?:\.|,|$)/i);
            if (becauseMatch) {
                relationships.depends_on_hints.push(becauseMatch[1].trim());
            }
            if (this.patterns.contradiction.test(line)) {
                relationships.contradicts_hints.push(line.trim());
            }
            if (this.patterns.supersession.test(line)) {
                relationships.supersedes_hints.push(line.trim());
            }
        }

        let primaryType = 'observation';
        if (signals.includes('decision')) primaryType = 'decision';
        else if (signals.includes('insight')) primaryType = 'insight';
        else if (signals.includes('question')) primaryType = 'question';
        else if (signals.includes('reasoning')) primaryType = 'reasoning';

        return { primaryType, signals, relationships };
    }

    getOverlapLines(lines) {
        let overlapTokens = 0;
        const overlap = [];

        for (let i = lines.length - 1; i >= 0; i--) {
            const lineTokens = Math.ceil(lines[i].length / 4);
            if (overlapTokens + lineTokens > this.options.overlapTokens) break;
            overlap.unshift(lines[i]);
            overlapTokens += lineTokens;
        }

        return overlap;
    }

    async checkMemoryPressure() {
        const usage = process.memoryUsage();

        if (usage.rss > this.options.rssLimit) {
            this.stats.flushCount++;

            if (this.options.flushCallback) {
                await this.options.flushCallback();
            }

            if (global.gc) {
                global.gc();
            }

            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    extractCAPs(segment, options = {}) {
        const caps = [];

        const cap = new CognitiveAnchor({
            type: segment.type,
            content: segment.content,
            reasoning_trace: segment.signals.includes('reasoning')
                ? this.extractReasoningTrace(segment.content)
                : null,
            source: {
                type: 'bootstrap',
                file: options.sourceFile,
                lineStart: segment.lineStart,
                lineEnd: segment.lineEnd
            },
            tags: [...segment.headers, ...segment.signals],
            meta: {
                bootstrap: true,
                session_id: options.sessionId
            }
        });

        caps.push(cap);
        this.stats.capsExtracted++;

        return caps;
    }

    extractReasoningTrace(content) {
        const sentences = content.split(/[.!?]+/);
        const reasoning = sentences.filter(s =>
            this.patterns.reasoning.test(s)
        );

        return reasoning.length > 0
            ? reasoning.join('. ').trim()
            : null;
    }

    getStats() {
        return {
            ...this.stats,
            mbProcessed: (this.stats.bytesProcessed / (1024 * 1024)).toFixed(2)
        };
    }
}

module.exports = StreamParser;
