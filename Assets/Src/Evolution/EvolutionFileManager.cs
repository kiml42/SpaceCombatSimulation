using Assets.Src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

public class EvolutionFileManager : MonoBehaviour {
    public string GeneralFolder = "./tmp/evolvingShipsTargetShooting";
    public string ThisRunFolder = "1";
    private string _currentGenerationFilePath;
    public string CurrentGenerationFilePath
    {
        get
        {
            if (string.IsNullOrEmpty(_currentGenerationFilePath))
                Start();
            return _currentGenerationFilePath;
        }
    }
    private string _generationFilePathBase;
    public string GenerationFilePathBase {
        get {
            if (string.IsNullOrEmpty(_generationFilePathBase))
                Start();
            return _generationFilePathBase;
        }
    }

    void Start()
    {
        var basePath = Path.Combine(GeneralFolder, ThisRunFolder);
        _currentGenerationFilePath = Path.Combine(basePath, "CurrentGeneration.txt");
        _generationFilePathBase = Path.Combine(basePath, "Generations/G-");
    }

    public string PathForThisGeneration(int generationNumber)
    {
        var generationFilePath = _generationFilePathBase + (generationNumber.ToString().PadLeft(6, '0'));
        return generationFilePath;
    }

    public void SaveGeneration(IGeneration _currentGeneration, int generationNumber)
    {
        string path = PathForThisGeneration(generationNumber);
        //Debug.Log("Saving to " + Path.GetFullPath(path));
        if (!File.Exists(path))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
        }
        File.WriteAllText(path, _currentGeneration.ToString());
        File.WriteAllText(_currentGenerationFilePath, generationNumber.ToString());
    }
}
