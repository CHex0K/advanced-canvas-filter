import { CanvasData, CanvasEdgeData, CanvasNodeData } from 'obsidian/canvas';
import { App, ItemView, Notice, Plugin, Modal, PluginSettingTab, Setting } from 'obsidian';

export interface CanvasGroupData extends CanvasNodeData {
	type: 'group',
	label: string
}

function isCanvasGroupData(node: CanvasNodeData): node is CanvasGroupData {
	return (node as any)?.type === 'group';
}

function nodeBondingBoxContains(outerNode: CanvasNodeData, innerNode: CanvasNodeData) {
	return outerNode.x <= innerNode.x
		&& (outerNode.x + outerNode.width) >= (innerNode.x + innerNode.width)
		&& outerNode.y <= innerNode.y
		&& (outerNode.y + outerNode.height) >= (innerNode.y + innerNode.height);
}

function showOnlyNodes(canvas: any, opacity: string, idsToShow?: Set<string>) {
    const nodes = canvas.nodes.values();

    for (const node of nodes) {
        if (idsToShow === undefined || idsToShow.has(node.id)) {
            node.nodeEl.style.opacity = ""; //skip because the plugin dynamically changes the transparency of objects
        } else {
            node.nodeEl.style.opacity = opacity; //skip because the plugin dynamically changes the transparency of objects
        }
    }
}

function showOnlyEdges(canvas: any, opacity: string, idsToShow?: Set<string>) {
    const edges = canvas.edges.values();

    for (const edge of edges) {
        if (idsToShow === undefined || idsToShow.has(edge.id)) {
            edge.lineGroupEl.style.opacity = ""; //skip because the plugin dynamically changes the transparency of objects
            edge.lineEndGroupEl.style.opacity = ""; //skip because the plugin dynamically changes the transparency of objects
        } else {
            edge.lineGroupEl.style.opacity = opacity; //skip because the plugin dynamically changes the transparency of objects
            edge.lineEndGroupEl.style.opacity = opacity; //skip because the plugin dynamically changes the transparency of objects
        }
    }
}

function getGroupsFor(allNodes: CanvasNodeData[], nonGroupNodes: CanvasNodeData[]) {
	return allNodes.filter(x => isCanvasGroupData(x)
		&& nonGroupNodes.some(fn => nodeBondingBoxContains(x, fn)));
}

function getEdgesWhereBothNodesInSet(allEdges: CanvasEdgeData[], nodeIds: Set<string>) {
	return allEdges
		.filter(edge => nodeIds.has(edge.fromNode)
			&& nodeIds.has(edge.toNode));
}

//добавление в словарь группы тегов, которые не вошли в другие группы
function addUndefinedGroup(groupsDictionary: { [key: string]: string[] }, newArray: string[]): { [key: string]: string[] } {
    // Создаем копию словаря, чтобы не изменять исходный
    const newGroupsDictionary = { ...groupsDictionary };

    // Проверяем, существует ли уже группа "undefined"
    if (newGroupsDictionary.hasOwnProperty("Other tags")) {
        // Удаляем "undefined" из списка групп для итерации
        delete newGroupsDictionary["Other tags"];
    
    }

    // Создаем новую группу
    const undefinedGroup: string[] = newArray.filter(tag => {
        // Фильтруем только теги, которых нет в существующих группах
        for (const group in newGroupsDictionary) {
            if (newGroupsDictionary[group].includes(tag)) {
                return false; // Тег уже есть в какой-то из групп
            }
        }
        return true; // Тега нет ни в одной из существующих групп
    });

    // Добавляем новую группу в словарь
    newGroupsDictionary["Other tags"] = undefinedGroup;

    return newGroupsDictionary;
}
//фунция выбирающая ноды для показа
function filterNodes(canvasData: any, tagsToShow: string[], mode: string): any[] {
    
    return canvasData.nodes.filter((node: any) => {
        if (mode === "Any Tag Inclusion") {
            // Режим 1: Проверяем, содержит ли текущий элемент хотя бы один из выбранных тегов
            if (node.type === "file") {
                const metadata = this.app.metadataCache.getCache(node.file);
                return metadata?.tags?.some((x: any) => tagsToShow.includes(x.tag));
            } else if (node.type === "text") {
                return tagsToShow.some((t: string) => (node as any).text.includes(t));
            } else {
                return false; // Если узел не является файлом или текстом, не удовлетворяет условию
            }
        } else if (mode === "All Tags Inclusion") {
            // Режим 2: Проверяем, содержит ли текст узла ВСЕ теги из списка
            if (node.type === "file") {
                const metadata = this.app.metadataCache.getCache(node.file);
                const nodeTags = metadata?.tags?.map((tag: { tag: string }) => tag.tag);
                if (!nodeTags) return false; // Если нет тегов у файла, сразу возвращаем false
                return tagsToShow.every((t: string) => nodeTags.includes(t));
            } else if (node.type === "text") {
                return tagsToShow.every((t: string) => (node as any).text.includes(t));
            } else {
                return false; // Если узел не является файлом или текстом, не удовлетворяет условию
            }
        } else {
            // Некорректный режим
            console.error("Invalid mode: " + mode);
            return false;
        }
    });
}


interface FilterPluginSettings {
    mySetting: string;
    checkboxGroups: { [key: string] : string[]};
    checkboxStates: { [name: string]: boolean };
    jsonInput: string;
    //добавлять ли новую группу ненайденных тегов
    addOtherTagsGroup : boolean;
    //прозрачность скрытых элементов
    HidenOpacity: string;
    //выбор режима фильтрации
    FilterMode: string;
}

const DEFAULT_SETTINGS: FilterPluginSettings = {
    mySetting: 'default',
    checkboxGroups: {"Group 1": ["#tag1", "#tag2", "#tag3"], "Group 2": ["#tag4", "#tag5", "#tag6"] },
    checkboxStates: {},
    jsonInput: '{"exampe group": ["#example_tag"]}',

    addOtherTagsGroup : false,
    HidenOpacity: "0.5",
    FilterMode: "All Tags Inclusion"
}


export default class FilterPlugin extends Plugin {
    settings: FilterPluginSettings;

    async onload() {
        await this.loadSettings();
        this.registerEvent(this.app.workspace.on('active-leaf-change', this.onActiveLeafChange));
        

        // This creates an icon in the left ribbon.
        const ribbonIconEl = this.addRibbonIcon('filter', 'Advanced Canvas Filter', (evt: MouseEvent) => {
            // Called when the user clicks the icon.
            new PlugInterface(this.app, this.settings, this.saveSettings.bind(this), this.getActiveCheckboxes.bind(this), this).open();
        });


        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new FilterSettingTab(this.app, this));


    }

    // Обработчик события изменения активного представления
    onActiveLeafChange = async () => {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
        if (!canvasView) return; 

        // Проверяем, является ли активное представление видом "canvas"
        if (canvasView.getViewType() === 'canvas') {
            //при переходе пользователя на canvas происходит фильтрация по тегам
            let activeCheckboxes: string[] = this.getActiveCheckboxes(); 
            this.showNodesByTags(activeCheckboxes);
        }
    };


    //проверка активен ли canvas
    private ifActiveViewIsCanvas = (commandFn: (canvas: any, canvasData: CanvasData) => void) => (checking: boolean) => {
		const canvasView = this.app.workspace.getActiveViewOfType(ItemView);

		if (canvasView?.getViewType() !== 'canvas') {
			if (checking) {
				return false;
			}
			return;
		}

		if (checking) {
			return true;
		}

		const canvas = (canvasView as any).canvas;
		if (!canvas) {
			return;
		};

		const canvasData = canvas.getData() as CanvasData;

		if (!canvasData) {
			return;
		};

		return commandFn(canvas, canvasData);
	}


    async showNodesByTags(tagsToShow: string[]) {
        await this.ifActiveViewIsCanvas(async (canvas, canvasData) => {

            //отображение всех
            showOnlyNodes(canvas, this.settings.HidenOpacity);
            showOnlyEdges(canvas, this.settings.HidenOpacity);

            // Режим 1: Проверяет, содержит ли текущий элемент хотя бы один из выбранных тегов
            const nodesToShow = filterNodes(canvasData, tagsToShow,  this.settings.FilterMode);

            // Режим 2: Проверяет, содержит ли текст узла ВСЕ теги из списка
    
            const groupsToShow = getGroupsFor(canvasData.nodes, nodesToShow);

            const nodeIdsToShow = new Set(nodesToShow.map((x: any) => x.id));
    
            const edgesToShow = getEdgesWhereBothNodesInSet(canvasData.edges, nodeIdsToShow);
    
            for (const group of groupsToShow) {
                nodeIdsToShow.add(group.id);
            }
    
            showOnlyNodes(canvas, this.settings.HidenOpacity, nodeIdsToShow);
            showOnlyEdges(canvas, this.settings.HidenOpacity, new Set(edgesToShow.map((x: any) => x.id)));

            if (tagsToShow.length === 0) {
                showOnlyNodes(canvas,this.settings.HidenOpacity);
                showOnlyEdges(canvas,this.settings.HidenOpacity);
            }
        })(false); // Передаем false в checking, так как мы не выполняем проверку, а прямо выполняем команду
    }



    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    getActiveCheckboxes(): string[] {
        const activeCheckboxes: string[] = [];
        for (const name in this.settings.checkboxStates) {
            if (this.settings.checkboxStates.hasOwnProperty(name) && this.settings.checkboxStates[name]) {
                activeCheckboxes.push(name);
            }
        }
        return activeCheckboxes;
    }
}
    //класс интерфейса при нажатии на значек
    class PlugInterface extends Modal {
        checkboxGroupsContainer: HTMLDivElement;
        settings: FilterPluginSettings;
        saveSettingsFunc: () => void;
        getActiveCheckboxesFunc: () => string[];
        outerApp: FilterPlugin;

    
        constructor(app: App, settings: FilterPluginSettings, saveSettingsFunc: () => void, getActiveCheckboxesFunc: () => string[], outerApp : FilterPlugin) {
            super(app);
            this.settings = settings;
            this.saveSettingsFunc = saveSettingsFunc;
            this.getActiveCheckboxesFunc = getActiveCheckboxesFunc;
            this.outerApp=outerApp;
        }

    async onOpen() {
        const {contentEl} = this;
        // Создаем контейнер для групп чекбоксов
        this.checkboxGroupsContainer = contentEl.createEl('div');
        this.checkboxGroupsContainer.addClass('checkbox-groups-container');

        //////////////////создание текстового поля для ввода json ////////////////
        const jsonInputContainer = contentEl.createEl('div');
        jsonInputContainer.createEl('h3', { text: "Json structure"});
        jsonInputContainer.addClass('json-input-container');
        const jsonInput = jsonInputContainer.createEl('textarea', { attr: { rows: "1" } }) as HTMLTextAreaElement;
        jsonInput.value = this.settings.jsonInput;
        jsonInput.placeholder = "Enter JSON for checkbox groups";
        ////////////////////////////////////////////////////////////////////////

        ////////////Добавляем кнопку для сохранения JSON////////////////
        const saveButton = contentEl.createEl('button');
        saveButton.addClass('mod-cta-json'); // Применяем стиль mod-cta
        saveButton.setText('Refresh groups');

        saveButton.onclick = () => {
            try {
                //удаление старого для создания нового
                this.checkboxGroupsContainer.empty();

                const jsonData = JSON.parse(jsonInput.value);
                this.settings.checkboxGroups = jsonData;
                this.settings.jsonInput = jsonInput.value;
                this.saveSettingsFunc();
                new Notice('JSON saved successfully');
                this.refreshCheckboxGroups();
            } catch (error) {
                new Notice('Error parsing JSON');
                console.error(error);
            }
        };

        contentEl.appendChild(saveButton); 

        ///////////////////////////////////////////////////////////////


        ////////////Добавляем кнопку для сброса////////////////
        const resetButton = contentEl.createEl('button');
        resetButton.addClass('mod-cta-reset'); 
        resetButton.setText('Reset');

        resetButton.onclick = () => {
            this.settings.checkboxStates = {};
            this.saveSettingsFunc()

            // Получаем все чекбоксы на странице
            const checkboxes = document.querySelectorAll('input[type="checkbox"]');

            // Проходимся по каждому чекбоксу и снимаем флажок
            checkboxes.forEach((checkbox) => {
                if (checkbox instanceof HTMLInputElement) {
                    checkbox.checked = false;
                }
            });
        };

        contentEl.appendChild(resetButton); 
        /////////////////////////////////////////////


        this.refreshCheckboxGroups()

    }

    //переотрисовка групп с чекбоксами
    refreshCheckboxGroups() {
        if (!this.checkboxGroupsContainer) return;

        
        //добавление группы ненайденных тегов
        if (this.settings.addOtherTagsGroup){
            this.settings.checkboxGroups=addUndefinedGroup(this.settings.checkboxGroups, this.getUniqueTags())
        }
        else { 
            if (this.settings.checkboxGroups.hasOwnProperty("Other tags")) {
                delete this.settings.checkboxGroups["Other tags"];
            
            }
        }

        //Отображение групп с тегами
        Object.keys(this.settings.checkboxGroups).forEach(groupName => {
            
            const groupContainer = this.checkboxGroupsContainer.createEl('div');
            groupContainer.createEl('h3', { text: groupName });
    
            this.settings.checkboxGroups[groupName].forEach(tag => this.createCheckbox(groupContainer, tag));
        });

    }

    createCheckbox(container: HTMLElement, name: string) {
        const checkbox = container.createEl('label');
        checkbox.setText(name);
        const checkboxInput = checkbox.createEl('input');
        checkboxInput.setAttribute('type', 'checkbox');
        checkboxInput.checked = this.settings.checkboxStates[name] ?? false; // Set checkbox state from settings
        checkboxInput.onchange = () => {
            this.settings.checkboxStates[name] = checkboxInput.checked;
            this.saveSettingsFunc(); // Save settings
        };
    }
    onClose() {
        const {contentEl} = this;
        contentEl.empty();


        let s :string[] = this.getActiveCheckboxesFunc(); // Call getActiveCheckboxes function
        this.outerApp.showNodesByTags(s)
    }

    //получение уникальных тэгов 
    getUniqueTags(): string[] {
        // Get all unique tags from nodes on canvas
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
        if (canvasView?.getViewType() !== 'canvas') {
            return [];
        }
    
        const canvasData = (canvasView as any).canvas.getData() as CanvasData;
        if (!canvasData) {
            return [];
        }
    
        const tags: Set<string> = new Set();
        canvasData.nodes.forEach((node: any) => {
            if (node.type === "text") {
                const textTags = node.text.match(/#[^\s]+/g);
                if (textTags) {
                    textTags.forEach((tag: string) => tags.add(tag));
                }
            } else if (node.type === "file") {
                const metadata = this.app.metadataCache.getCache(node.file);
                if (metadata && metadata.tags) {
                    metadata.tags.forEach((tag: { tag: string }) => tags.add(tag.tag));
                }
            }
        });
    
        // Преобразуем set в массив строк и возвращаем его
        return Array.from(tags);
    }
    
}

//класс настроек
class FilterSettingTab extends PluginSettingTab {
    plugin: FilterPlugin;

    constructor(app: App, plugin: FilterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Add "Other tags" group')
            .setDesc('Select this check box to add the "Other Tags" group. This group will contain tags that are not included in other groups.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addOtherTagsGroup) // Устанавливаем значение чекбокса из настроек
                .onChange(async (value) => {
                    this.plugin.settings.addOtherTagsGroup = value; // Сохраняем значение чекбокса в настройки
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Hidden opacity')
            .setDesc('Adjust the opacity level for hidden elements. Value must been between 0 and 1')
            .addText(text => text
                .setValue(this.plugin.settings.HidenOpacity) // Устанавливаем значение текстового поля из настроек
                .onChange(async (value) => {
                    const parsedValue = parseFloat(value);
                    // Убеждаемся, что значение находится в диапазоне от 0 до 1
                    const newValue = Math.max(0, Math.min(parsedValue, 1));
                    this.plugin.settings.HidenOpacity = newValue.toString(); // Сохраняем значение в настройки в виде строки
                    await this.plugin.saveSettings();
                })
                .setPlaceholder('between 0 and 1')
                
            );
            new Setting(containerEl)
            .setName('Filter mode')
            .setDesc('"Any Tag Inclusion" means that nodes will be shown if they contain at least one of the selected tags. "All Tags Inclusion" means that nodes will only be shown if they contain all of the selected tags.')
            .addDropdown(dropdown => dropdown
                .addOption("All Tags Inclusion", "All Tags Inclusion") // Добавляем каждый вариант отдельно
                .addOption("Any Tag Inclusion", "Any Tag Inclusion")
                .setValue(this.plugin.settings.FilterMode) // Устанавливаем значение из настроек
                .onChange(async (value) => {
                    this.plugin.settings.FilterMode = value; // Сохраняем значение в настройки
                    await this.plugin.saveSettings();
                }));
    }
}

