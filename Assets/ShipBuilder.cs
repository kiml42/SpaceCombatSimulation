using Assets.Src.Interfaces;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using System;
using Assets.Src.ObjectManagement;

public class ShipBuilder : MonoBehaviour, IKnowsEnemyTagAndtag
{
    public string EnemyTag = "Enemy";
    public bool TagChildren = false;

    public string GetEnemyTag()
    {
        return EnemyTag;
    }

    public void SetEnemyTag(string newTag)
    {
        EnemyTag = newTag;
    }
    
    public string Genome = "01234567893210";

    /// <summary>
    /// Module 0 should be the only one with its own spawnPoints
    /// </summary>
    public Rigidbody Module0, Module1, Module2, Module3, Module4,
        Module5, Module6, Module7, Module8, Module9;

    private int _genomePosition = 0;

    // Use this for initialization
    void Start ()
    {
        transform.SetColor(
            GetNumberFromGenome( 0),
            GetNumberFromGenome( 2),
            GetNumberFromGenome( 4)
            );
        SpawnModules(transform);
	}

    public void SetGenome(string genome)
    {
        Genome = genome;
    }

    private void SpawnModules(Transform currentHub)
    {
        var _spawnPoints = GetSpawnPoints(currentHub);
        foreach (var spawnPoint in _spawnPoints)
        {
            if(_genomePosition < Genome.Length) {
                var letter = Genome.ElementAt(_genomePosition);
                _genomePosition++;

                var moduleToAdd = SelectModule(letter);
                if (moduleToAdd != null)
                {
                    var addedModule = Instantiate(moduleToAdd, spawnPoint.position, spawnPoint.rotation, spawnPoint);
                    addedModule.transform.parent = currentHub;
                    addedModule.GetComponent<FixedJoint>().connectedBody = currentHub.GetComponent<Rigidbody>();
                    addedModule.SendMessage("SetEnemyTag", EnemyTag, SendMessageOptions.DontRequireReceiver);
                    if (TagChildren) {
                        addedModule.tag = tag;
                    }
                    if (letter == '0')
                    {
                        //spawn modules on this module
                        SpawnModules(addedModule.transform);
                    }
                    addedModule.transform.SetColor(
                        GetNumberFromGenome( 0),
                        GetNumberFromGenome( 2),
                        GetNumberFromGenome( 4)
                        );
                }
            }
        }
    }
    
    private float GetNumberFromGenome(int fromStart)
    {
        var simplified = Genome.Replace(" ", "");
        if (simplified.Length > fromStart)
        {
            simplified = simplified + "  ";
            var stringNumber = simplified.Substring(fromStart, 2);
            int number;
            if (int.TryParse(stringNumber, out number))
            {
                return number / 99f;
            }
        }
        return 1;
    }

    private List<Transform> GetSpawnPoints(Transform currentHub)
    {
        var _spawnPoints = new List<Transform>();
        var childCount = currentHub.childCount;
        for (int i = 0; i < childCount; i++)
        {
            var child = currentHub.GetChild(i);
            if (child.name.Contains("SP"))
            {
                _spawnPoints.Add(child);
            }
        }
        return _spawnPoints;
    }

    private Rigidbody SelectModule(char letter)
    {
        switch (letter)
        {
            case '0':
                return Module0;
            case '1':
                return Module1;
            case '2':
                return Module2;
            case '3':
                return Module3;
            case '4':
                return Module4;
            case '5':
                return Module5;
            case '6':
                return Module6;
            case '7':
                return Module7;
            case '8':
                return Module8;
            case '9':
                return Module9;
            default:
                return null;
        }
    }

    // Update is called once per frame
    void Update () {
		
	}
}
