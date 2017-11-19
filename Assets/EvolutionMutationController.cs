using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EvolutionMutationController : MonoBehaviour {

    public int Mutations = 3;

    public string AllowedCharacters = " 0123456789  ";

    public int MaxMutationLength = 5;

    public int GenomeLength = 50;

    private StringMutator _mutator;

    public bool UseCompletelyRandomDefaultGenome = false;
    public string DefaultGenome = "";

    void Start()
    {
        _mutator = new StringMutator
        {
            AllowedCharacters = AllowedCharacters,
            GenomeLength = GenomeLength,
            MaxMutationLength = MaxMutationLength,
            Mutations = Mutations
        };
    }

    public List<string> CreateGenerationOfMutants(List<string> baseGenomes, int generationSize)
    {
        return _mutator.CreateGenerationOfMutants(baseGenomes, generationSize);
    }

    public List<string> CreateDefaultGeneration(int generationSize)
    {
        var defaultGenomes = UseCompletelyRandomDefaultGenome ? null : new List<string> { DefaultGenome };
        return CreateGenerationOfMutants(defaultGenomes, generationSize);
    }
}
