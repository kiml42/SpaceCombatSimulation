using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class SpawnTurret : MonoBehaviour, IKnowsEnemyTagAndtag
{
    public bool TagChildren = false;

    #region EnemyTags
    public void AddEnemyTag(string newTag)
    {
        var tags = EnemyTags.ToList();
        tags.Add(newTag);
        EnemyTags = tags.Distinct().ToList();
    }

    public string GetFirstEnemyTag()
    {
        return EnemyTags.FirstOrDefault();
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

    public Transform TurretParent;

	// Use this for initialization
	void Start () {

        var turret = Instantiate(TurretParent, transform.position, transform.rotation, transform);
        turret.parent = transform.parent;

        turret.GetComponent<FixedJoint>().connectedBody = transform.parent.GetComponent<Rigidbody>();
        turret.SendMessage("SetEnemyTags", EnemyTags);
        if (TagChildren) { turret.tag = tag; }

        var renderer = transform.parent.GetComponent("Renderer") as Renderer;
        if (renderer != null)
        {
            //Debug.Log("has renderer");
            turret.transform.SetColor(renderer.material.color);
        }

        Destroy(gameObject);
    }
	
	// Update is called once per frame
	void Update () {
		
	}
}
