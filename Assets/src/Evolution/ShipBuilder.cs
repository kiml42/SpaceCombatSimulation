using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.Evolution
{
    public class ShipBuilder : IKnowsEnemyTags
    {

        #region EnemyTags
        public void AddEnemyTag(string newTag)
        {
            var tags = EnemyTags.ToList();
            tags.Add(newTag);
            EnemyTags = tags.Distinct().ToList();
        }

        public void SetEnemyTags(List<string> allEnemyTags)
        {
            EnemyTags = allEnemyTags;
        }

        public List<string> GetEnemyTags()
        {
            return EnemyTags;
        }

        public List<string> EnemyTags;
        #endregion

        public int MaxTurrets = 10;
        public int MaxModules = 15;
        private int _turretsAdded = 0;
        private int _modulesAdded = 0;

        public int MaxShootAngle = 1;
        public int MaxTorqueMultiplier = 2000;
        public int MaxLocationAimWeighting = 10;
        public int MaxSlowdownWeighting = 60;
        public int MaxLocationTollerance = 1000;
        public int MaxVelociyTollerance = 200;
        public int MaxAngularDragForTorquers = 1;

        public Vector3 InitialVelocity = Vector3.zero;


        private string _genome;
        public int GeneLength = 1;

        public List<Rigidbody> Modules;

        private int _genomePosition = 0;
        private float _r;
        private float _g;
        private float _b;
        private Transform _shipToBuildOn;
        private Rigidbody _testCubePrefab;

        public ShipBuilder(string genome, Transform shipToBuildOn, List<Rigidbody> modules, Rigidbody testCubePrefab = null)
        {
            _shipToBuildOn = shipToBuildOn;
            Modules = modules;
            _genome = genome;
            _testCubePrefab = testCubePrefab;
        }

        public void BuildShip()
        {
            //Debug.Log("Building " + _genome);
            _r = GetNumberFromGenome(0, 8);
            _g = GetNumberFromGenome(10, 8);
            _b = GetNumberFromGenome(20, 8);
            _shipToBuildOn.SetColor(_r, _g, _b);
            _shipToBuildOn.name = _genome;
            //Debug.Log("Spawning modules");
            SpawnModules(_shipToBuildOn);

            ConfigureShip();
        }

        public void SetGenome(string genome)
        {
            _genome = genome;
        }

        private void SpawnModules(Transform currentHub)
        {
            var spawnPoints = GetSpawnPoints(currentHub);
            if (spawnPoints.Any())
            {
                //this is a hub - add more modules to it
                foreach (var spawnPoint in spawnPoints)
                {
                    if (CanSpawnHere(spawnPoint, currentHub))
                    {
                        var moduleToAdd = SelectModule();

                        if (moduleToAdd != null)
                        {
                            var addedModule = GameObject.Instantiate(moduleToAdd, spawnPoint.position, spawnPoint.rotation, currentHub);

                            //addedModule.transform.parent = currentHub;
                            addedModule.GetComponent<FixedJoint>().connectedBody = currentHub.GetComponent<Rigidbody>();
                            addedModule.SendMessage("SetEnemyTags", EnemyTags, SendMessageOptions.DontRequireReceiver);

                            addedModule.tag = currentHub.tag;

                            SpawnModules(addedModule.transform);    //spawn modules on this module

                            addedModule.transform.SetColor(_r, _g, _b);
                            addedModule.velocity = InitialVelocity;
                        }
                    }
                    //else
                    //{
                    //    Debug.Log("Can Spawn No More modules. _genomePosition: " + _genomePosition + ", _turretsAdded: " + _turretsAdded + ", _modulesAdded: " + _modulesAdded);
                    //}
                }
            }
            else
            {
                //this has no spawn points, so it must be aturret or engine - increment added turrets.
                //Debug.Log("Cannot spawn on " + currentHub);
                _turretsAdded++;
            }
            _modulesAdded++;
        }

        private bool CanSpawnHere(Transform spawnPoint, Transform parent = null)
        {
            if (_testCubePrefab != null)
            {
                Debug.Log("Creating Test Cube");
                var testCube = GameObject.Instantiate(_testCubePrefab, spawnPoint.position, spawnPoint.rotation);
                if(parent != null)
                {
                    testCube.transform.parent = parent;
                    testCube.GetComponent<FixedJoint>().connectedBody = parent.GetComponent<Rigidbody>();
                }
                var collider = testCube.GetComponent<TestCubeChecker>();
            }
            return _genomePosition < _genome.Length && _turretsAdded < MaxTurrets && _modulesAdded < MaxModules;
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

        private Rigidbody SelectModule()
        {
            if (_genomePosition + GeneLength < _genome.Length)
            {
                var substring = _genome.Substring(_genomePosition, GeneLength);
                //Debug.Log("Gene to spawn: " + substring);
                _genomePosition += GeneLength;

                var simplified = substring.Replace(" ", "");

                int number;
                if (int.TryParse(simplified, out number))
                {
                    //Debug.Log("Gene as number: " + number);
                    if (number < Modules.Count())
                    {
                        //Debug.Log("Adding Module " + number + ": " + Modules[number] );
                        return Modules[number];
                    }
                    //else
                    //{
                    //    Debug.Log("there are " + Modules.Count() + " modules, so cannot spawn number " + number);
                    //}
                }
                //else
                //{
                //    Debug.Log("Failed to parse " + simplified + "as a number");
                //}
            }
            //else
            //{
            //    Debug.Log("Cannot read gene of length" + GeneLength + " at position " + _genomePosition + " in " + _genome);
            //}
            return null;
        }

        private void ConfigureShip()
        {
            var controller = _shipToBuildOn.GetComponent<SpaceShipControler>();

            //Debug.Log("ConfiguringShip");

            controller.ShootAngle = GetNumberFromGenome(0) * MaxShootAngle;
            controller.TorqueMultiplier = GetNumberFromGenome(2) * MaxTorqueMultiplier;
            controller.LocationAimWeighting = GetNumberFromGenome(4) * MaxLocationAimWeighting;
            controller.SlowdownWeighting = GetNumberFromGenome(6) * MaxSlowdownWeighting;
            controller.MaxRange = GetNumberFromGenome(8) * MaxLocationTollerance;
            controller.MinRange = GetNumberFromGenome(10) * MaxLocationTollerance;
            controller.MaxTangentialVelocity = GetNumberFromGenome(12) * MaxVelociyTollerance;
            controller.MinTangentialVelocity = GetNumberFromGenome(14) * MaxVelociyTollerance;
            controller.TangentialSpeedWeighting = GetNumberFromGenome(16) * MaxSlowdownWeighting;
            controller.AngularDragForTorquers = GetNumberFromGenome(18) * MaxAngularDragForTorquers;
            controller.RadialSpeedThreshold = GetNumberFromGenome(20) * MaxVelociyTollerance;
        }

        private float GetNumberFromGenome(int fromEnd, int length = 2)
        {
            var reversed = Reverse(_genome);
            if (fromEnd + length < reversed.Length)
            {
                var substring = reversed.Substring(fromEnd, length);
                
                var simplified = substring.TrimStart().Replace(" ", "0");
                //Debug.Log(simplified);
                int number;
                if (int.TryParse(simplified, out number))
                {
                    return (float)(number / (Math.Pow(10, length) - 1));
                }
            }
            //Debug.Log("Defaulted to 0.5");
            return .5f;
        }

        public static string Reverse(string s)
        {
            char[] charArray = s.ToCharArray();
            Array.Reverse(charArray);
            return new string(charArray);
        }
    }
}

