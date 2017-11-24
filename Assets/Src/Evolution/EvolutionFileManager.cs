using Assets.Src.Evolution;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

public class EvolutionFileManager : MonoBehaviour {
    public string GeneralFolder = "./tmp/evolvingShipsTargetShooting";
    public string ThisRunFolder = "1";
    private string _configFilePath;
    public string ConfigFilePath
    {
        get
        {
            if (string.IsNullOrEmpty(_configFilePath))
                Start();
            return _configFilePath;
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
        _configFilePath = Path.Combine(basePath, "CurrentGeneration.txt");
        _generationFilePathBase = Path.Combine(basePath, "Generations/G-");
    }

    public string PathForThisGeneration(int generationNumber)
    {
        var generationFilePath = _generationFilePathBase + (generationNumber.ToString().PadLeft(6, '0'));
        return generationFilePath;
    }

    /// <summary>
    /// Reads the config file, returns null if it doesn't exist.
    /// </summary>
    /// <returns></returns>
    public string[] ReadConfigFile()
    {
        if (File.Exists(ConfigFilePath))
        {

            return File.ReadAllLines(ConfigFilePath);
        }
        Debug.Log("Config File not found mutating default for new generation");
        return null;
    }

    public void SaveGeneration(IGeneration _currentGeneration, int generationNumber, string[] configData = null)
    {
        string path = PathForThisGeneration(generationNumber);
        //Debug.Log("Saving to " + Path.GetFullPath(path));
        if (!File.Exists(path))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
        }
        File.WriteAllText(path, _currentGeneration.ToString());
        if(configData == null)
        {
            Debug.LogWarning("no configData provided - saving old style generation file.");
            File.WriteAllText(_configFilePath, generationNumber.ToString());
        } else
        {
            File.WriteAllLines(_configFilePath, configData);
        }
    }
}
